import { createClient } from '@vercel/kv'
import { fetchCandles } from '../../src/lib/yahoo.js'
import { detectSignal } from '../../src/lib/signals.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const STRATEGY_CONFIG = {
  scalping: {
    label:     '⚡ Scalping',
    maxAlerts: 3,
    horizon:   '2-5 dni',
    universe: {
      GPW:  ['pkn.pl','kghm.pl','pko.pl','pzu.pl','cdr.pl','ale.pl','mbk.pl','lpp.pl','pge.pl','jsw.pl','dnp.pl','kty.pl','cps.pl','peo.pl','spl.pl'],
      NYSE: ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','JPM','BAC','JNJ','PG','TSLA','AMD','CRM','SNOW','PLTR'],
    },
    describe:  s => `RSI = ${s.rsi?.toFixed(1)} (wyprzedany), wolumen ${s.volMult}x powyżej średniej. Potencjalne odbicie krótkoterminowe.`,
    kvExtra:   s => ({ rsi: s.rsi }),
  },
  swing: {
    label:     '📈 Swing',
    maxAlerts: 1,
    horizon:   '4-8 tyg.',
    universe: {
      GPW:  ['kru.pl','acp.pl','bdx.pl','car.pl','cln.pl','dom.pl','eat.pl','gpw.pl','ing.pl','ker.pl','opl.pl','vrg.pl','pcf.pl','brs.pl','mlp.pl'],
      NYSE: ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','JPM','BAC','JNJ','PG','V','MA','HD','UNH','WMT'],
    },
    describe:  s => `Cena przebiła SMA50 od dołu przy wolumenie ${s.volMult}x. Sygnał swing wzrostowy.`,
    kvExtra:   () => ({}),
  },
  aggressive: {
    label:     '🚀 Agresywna',
    maxAlerts: 2,
    horizon:   'brak (wysoki risk)',
    universe: {
      GPW:  ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl'],
      NYSE: ['TSLA','AMD','CRM','SNOW','PLTR','COIN','RBLX','ROKU','SQ','SHOP'],
    },
    describe:  s => `Breakout powyżej max 20 dni, RSI ${s.rsi?.toFixed(1)}, wolumen ${s.volMult}x. ⚠️ WYSOKO RYZYKOWNA SPÓŁKA.`,
    kvExtra:   s => ({ rsi: s.rsi }),
  },
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const { strategy, exchange = 'GPW' } = req.query
  const config = STRATEGY_CONFIG[strategy]
  if (!config) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })

  const now = new Date()
  if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

  const thresholds = await kv.get(`${ENV}:thresholds`).catch(() => null) ?? {}
  const signals = []
  const universe = config.universe[exchange] ?? config.universe.GPW

  for (const ticker of universe) {
    try {
      const data = await fetchCandles(ticker, exchange)
      const candles = data?.candles
      if (!candles || candles.length < 25) continue
      const sig = detectSignal(candles, strategy, thresholds, exchange)
      if (sig) signals.push({ ...sig, ticker })
    } catch (e) {
      console.error(`cron ${strategy}: error scanning ${ticker}:`, e.message)
    }
  }

  let sent = 0
  for (const signal of signals.slice(0, config.maxAlerts)) {
    const alertId = `${ENV}:alert:${strategy}:${signal.ticker}:${Date.now()}`
    const portfolio    = 10000
    const positionSize = Math.round(portfolio * 0.15)

    const msg = formatAlert({
      ticker:       signal.ticker.replace('.pl', '').toUpperCase(),
      strategy:     config.label,
      price:        signal.price,
      signal:       signal.signal,
      target:       signal.signal === 'RSI_OVERSOLD' ? 5 : signal.signal === 'SMA50_CROSSOVER' ? 15 : 35,
      stopLoss:     signal.signal === 'RSI_OVERSOLD' ? 3 : signal.signal === 'SMA50_CROSSOVER' ? 5  : 8,
      portfolio,
      positionSize,
      shares:       Math.floor(positionSize / signal.price),
      description:  config.describe(signal),
      history:      'Dane historyczne w trakcie zbierania.',
      learning:     'Pierwsza analiza — brak wcześniejszych danych dla tej spółki.',
      exchange,
      currency:     exchange === 'NYSE' ? 'USD' : 'PLN',
      companyName:  null,
      horizon:      config.horizon,
    })

    await sendTelegram(msg, IS_STAGING)

    await kv.set(alertId, {
      id: alertId, ticker: signal.ticker, strategy, exchange,
      signal: signal.signal, price: signal.price,
      timestamp: now.toISOString(), targetAchieved: null,
      thresholdsAtSignal: thresholds,
      ...config.kvExtra(signal),
    }, { ex: 90 * 24 * 60 * 60 })

    sent++
  }

  res.json({ signals: signals.length, sent, exchange, strategy })
}
