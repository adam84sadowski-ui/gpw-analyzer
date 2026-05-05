import { createClient } from '@vercel/kv'
import { analyzeStrategy } from '../../src/agents/signalAnalyzer.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV_PREFIX = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// Manual trigger endpoint — staging only, for testing Telegram alerts
// No bearer token required: staging is protected by Vercel Deployment Protection
export default async function handler(req, res) {
  if (!IS_STAGING) return res.status(403).json({ error: 'Only available on staging' })
  if (req.method !== 'POST') return res.status(405).end()

  const { strategy = 'swing', force = false } = req.body ?? {}
  const validStrategies = ['scalping', 'swing', 'aggressive']
  if (!validStrategies.includes(strategy)) {
    return res.status(400).json({ error: 'strategy must be scalping|swing|swing|aggressive' })
  }

  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`) ?? {}
  const signals = await analyzeStrategy(strategy, thresholds)

  const STRATEGY_LABEL = { scalping: '⚡ Scalping', swing: '📈 Swing', aggressive: '🚀 Agresywna' }
  const STRATEGY_TARGET = { scalping: 5, swing: 15, aggressive: 35 }
  const STRATEGY_STOP   = { scalping: 3, swing: 5,  aggressive: 8 }

  // If no real signals and force=true, create a synthetic test signal
  const toSend = signals.length > 0 ? signals.slice(0, 1) : force ? [{
    ticker: 'pkn.pl', signal: 'TEST', price: 48.50,
    target: STRATEGY_TARGET[strategy], stopLoss: STRATEGY_STOP[strategy],
    volumeMultiplier: 1.8,
  }] : []

  if (toSend.length === 0) {
    return res.json({ sent: 0, message: 'Brak sygnałów. Użyj force=true aby wysłać testowy alert.' })
  }

  const signal = toSend[0]
  const portfolio = 10000
  const positionSize = Math.round(portfolio * 0.15)

  const msg = formatAlert({
    ticker:       signal.ticker.replace('.pl', '').toUpperCase(),
    strategy:     STRATEGY_LABEL[strategy],
    price:        signal.price,
    signal:       signal.signal,
    target:       signal.target,
    stopLoss:     signal.stopLoss,
    portfolio,
    positionSize,
    shares:       Math.floor(positionSize / signal.price),
    description:  force && signals.length === 0 ? 'Alert testowy — weryfikacja integracji Telegram.' : `Sygnał ${signal.signal} wykryty.`,
    history:      '',
    learning:     '',
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
