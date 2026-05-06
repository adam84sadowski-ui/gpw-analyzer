import { createClient } from '@vercel/kv'
import { fetchCandles } from '../../src/lib/yahoo.js'
import { detectSignal } from '../../src/lib/signals.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV_PREFIX = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const UNIVERSES = {
  scalping:   ['pkn.pl','kghm.pl','pko.pl','pzu.pl','cdr.pl','ale.pl','mbk.pl','lpp.pl','pge.pl','jsw.pl','dnp.pl','kty.pl','cps.pl','peo.pl','spl.pl'],
  swing:      ['kru.pl','acp.pl','bdx.pl','car.pl','cln.pl','dom.pl','eat.pl','gpw.pl','ing.pl','ker.pl','opl.pl','vrg.pl','pcf.pl','brs.pl','mlp.pl'],
  aggressive: ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl'],
}

const STRATEGY_LABEL  = { scalping: '⚡ Scalping', swing: '📈 Swing', aggressive: '🚀 Agresywna' }
const STRATEGY_TARGET = { scalping: 5, swing: 15, aggressive: 35 }
const STRATEGY_STOP   = { scalping: 3, swing: 5,  aggressive: 8 }
const HORIZONS        = { scalping: '2-5 dni', swing: '4-8 tyg.', aggressive: 'brak (wysoki risk)' }

export default async function handler(req, res) {
  if (!IS_STAGING) return res.status(403).json({ error: 'Only available on staging' })
  if (req.method !== 'POST') return res.status(405).end()

  const { strategy = 'swing', force = false } = req.body ?? {}
  if (!UNIVERSES[strategy]) {
    return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })
  }

  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`).catch(() => null) ?? {}
  const signals = []

  for (const ticker of UNIVERSES[strategy]) {
    try {
      const data = await fetchCandles(ticker, 'GPW')
      const candles = data?.candles
      if (!candles || candles.length < 25) continue
      const sig = detectSignal(candles, strategy, thresholds)
      if (sig) signals.push({ ...sig, ticker })
    } catch (e) {
      console.error(`trigger: error scanning ${ticker}:`, e.message)
    }
  }

  const toSend = signals.length > 0 ? signals.slice(0, 1) : force ? [{
    ticker: 'pkn.pl', signal: 'TEST', price: 48.50,
    target: STRATEGY_TARGET[strategy], stopLoss: STRATEGY_STOP[strategy],
    volumeMultiplier: 1.8,
  }] : []

  if (toSend.length === 0) {
    return res.json({ sent: 0, message: 'Brak sygnałów. Użyj force=true aby wysłać testowy alert.' })
  }

  const signal = toSend[0]
  const portfolio    = 10000
  const positionSize = Math.round(portfolio * 0.15)

  const msg = formatAlert({
    ticker:      signal.ticker.replace('.pl', '').toUpperCase(),
    strategy:    STRATEGY_LABEL[strategy],
    price:       signal.price,
    signal:      signal.signal,
    target:      signal.target ?? STRATEGY_TARGET[strategy],
    stopLoss:    signal.stopLoss ?? STRATEGY_STOP[strategy],
    portfolio,
    positionSize,
    shares:      Math.floor(positionSize / signal.price),
    description: force && signals.length === 0 ? 'Alert testowy — weryfikacja integracji Telegram.' : `Sygnał ${signal.signal} wykryty.`,
    history:     '',
    learning:    '',
    exchange:    'GPW',
    currency:    'PLN',
    companyName: null,
    horizon:     HORIZONS[strategy],
  })

  await sendTelegram(msg, true)

  if (signals.length > 0) {
    const alertId = `${ENV_PREFIX}:alert:${strategy}:${signal.ticker}:${Date.now()}`
    await kv.set(alertId, {
      id: alertId, ticker: signal.ticker, strategy,
      signal: signal.signal, price: signal.price,
      target: signal.target, stopLoss: signal.stopLoss,
      timestamp: new Date().toISOString(), targetAchieved: null,
    }, { ex: 90 * 24 * 60 * 60 })
  }

  res.json({ sent: 1, ticker: signal.ticker, force: force && signals.length === 0 })
}
