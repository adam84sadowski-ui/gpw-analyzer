import { createClient } from '@vercel/kv'
import { fetchCandles } from '../../src/lib/yahoo.js'
import { detectSignal } from '../../src/lib/signals.js'
import { interpretSignal } from '../../src/lib/interpretSignal.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV_PREFIX = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const UNIVERSES = {
  scalping: {
    GPW:  ['pkn.pl','kghm.pl','pko.pl','pzu.pl','cdr.pl','ale.pl','mbk.pl','lpp.pl','pge.pl','jsw.pl','dnp.pl','kty.pl','cps.pl','peo.pl','spl.pl','opl.pl','kru.pl','bdx.pl','acp.pl','ing.pl'],
    NYSE: ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','JPM','BAC','JNJ','PG','TSLA','AMD','CRM','SNOW','PLTR','ACN','IBM','INFY','CTSH','EPAM'],
  },
  swing: {
    GPW:  ['kru.pl','acp.pl','bdx.pl','car.pl','cln.pl','dom.pl','eat.pl','gpw.pl','ing.pl','ker.pl','opl.pl','vrg.pl','pcf.pl','brs.pl','mlp.pl','pkn.pl','kghm.pl','lpp.pl','pko.pl','cdr.pl'],
    NYSE: ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','JPM','BAC','JNJ','PG','V','MA','HD','UNH','WMT','ACN','EPAM','ORCL','SAP','CDNS'],
  },
  aggressive: {
    GPW:  ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl','trk.pl','pgn.pl','11b.pl','ccc.pl','xtb.pl'],
    NYSE: ['TSLA','AMD','CRM','SNOW','PLTR','COIN','RBLX','ROKU','SQ','SHOP','MSTR','ARM','CRWD','NET','DDOG'],
  },
}

const FORCE_TICKER  = { GPW: 'pkn.pl',  NYSE: 'AMD'   }
const FORCE_PRICE   = { GPW: 48.50,     NYSE: 200.00  }
const STRATEGY_LABEL  = { scalping: '⚡ Scalping', swing: '📈 Swing', aggressive: '🚀 Agresywna' }
const STRATEGY_TARGET = { scalping: 5, swing: 15, aggressive: 35 }
const STRATEGY_STOP   = { scalping: 3, swing: 5,  aggressive: 8 }
const HORIZONS        = { scalping: '2-5 dni', swing: '4-8 tyg.', aggressive: 'brak (wysoki risk)' }

export default async function handler(req, res) {
  if (!IS_STAGING) return res.status(403).json({ error: 'Only available on staging' })
  if (req.method !== 'POST') return res.status(405).end()

  const { strategy = 'swing', force = false, exchange = 'GPW' } = req.body ?? {}
  const universe = UNIVERSES[strategy]?.[exchange] ?? UNIVERSES[strategy]?.GPW
  if (!universe) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })

  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`).catch(() => null) ?? {}
  const signals = []

  for (const ticker of universe) {
    try {
      const data = await fetchCandles(ticker, exchange)
      const candles = data?.candles
      if (!candles || candles.length < 25) continue
      const sig = detectSignal(candles, strategy, thresholds, exchange)
      if (sig) signals.push({ ...sig, ticker })
    } catch (e) {
      console.error(`trigger: error scanning ${ticker}:`, e.message)
    }
  }

  const forceTicker = FORCE_TICKER[exchange] ?? FORCE_TICKER.GPW
  const forcePrice  = FORCE_PRICE[exchange]  ?? FORCE_PRICE.GPW

  const toSend = signals.length > 0 ? signals.slice(0, 1) : force ? [{
    ticker: forceTicker, signal: 'TEST', price: forcePrice, rsi: null, volMult: null,
  }] : []

  if (toSend.length === 0) {
    return res.json({ sent: 0, message: 'Brak sygnałów. Użyj force=true aby wysłać testowy alert.' })
  }

  const signal = toSend[0]
  const portfolio    = 10000
  const positionSize = Math.round(portfolio * 0.15)
  const target       = STRATEGY_TARGET[strategy]
  const stopLoss     = STRATEGY_STOP[strategy]
  const currency     = exchange === 'NYSE' ? 'USD' : 'PLN'
  const isForced     = force && signals.length === 0

  const interp = isForced ? null : interpretSignal(
    signal.signal,
    { rsi: signal.rsi, volMult: signal.volMult, price: signal.price, sma20: signal.sma20, sma50: signal.sma50 },
    strategy,
  )

  const displayTicker = exchange === 'NYSE'
    ? signal.ticker.toUpperCase()
    : signal.ticker.replace('.pl', '').toUpperCase()

  const msg = formatAlert({
    ticker:         displayTicker,
    strategy:       STRATEGY_LABEL[strategy],
    price:          signal.price,
    signal:         signal.signal,
    target,
    stopLoss,
    portfolio,
    positionSize,
    shares:         Math.floor(positionSize / signal.price),
    description:    isForced ? 'Alert testowy — weryfikacja integracji Telegram.' : `Sygnał ${signal.signal} wykryty.`,
    exchange,
    currency,
    companyName:    null,
    horizon:        HORIZONS[strategy],
    interpretation: interp,
  })

  await sendTelegram(msg, true)

  if (!isForced) {
    const alertId = `${ENV_PREFIX}:alert:${strategy}:${signal.ticker}:${Date.now()}`
    await kv.set(alertId, {
      id: alertId, ticker: signal.ticker, strategy, exchange,
      signal: signal.signal, price: signal.price,
      target, stopLoss,
      timestamp: new Date().toISOString(), targetAchieved: null,
    }, { ex: 90 * 24 * 60 * 60 })
  }

  res.json({ sent: 1, ticker: signal.ticker, force: isForced })
}
