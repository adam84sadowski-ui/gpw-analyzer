import { createClient } from '@vercel/kv'
import { analyzeStrategy } from '../../src/agents/signalAnalyzer.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV_PREFIX = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const STRATEGY_CONFIG = {
  scalping: {
    label:     '⚡ Scalping',
    maxAlerts: 3,
    describe:  s => `RSI = ${s.rsi} (oversold), wolumen ${s.volumeMultiplier}x powyżej średniej. Potencjalne odbicie krótkoterminowe.`,
    kvExtra:   s => ({ rsi: s.rsi }),
  },
  swing: {
    label:     '📈 Swing',
    maxAlerts: 1,
    describe:  s => `Cena przebiła SMA50 od dołu przy ponadprzeciętnym wolumenie (${s.volumeMultiplier}x). Sygnał swing wzrostowy.`,
    kvExtra:   () => ({}),
  },
  aggressive: {
    label:     '🚀 Agresywna',
    maxAlerts: 2,
    describe:  s => `Breakout powyżej max 20 dni, RSI ${s.rsi}, wolumen ${s.volumeMultiplier}x. Sygnał momentum. ⚠️ WYSOKO RYZYKOWNA SPÓŁKA.`,
    kvExtra:   s => ({ rsi: s.rsi }),
  },
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const { strategy } = req.query
  const config = STRATEGY_CONFIG[strategy]
  if (!config) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })

  const now = new Date()
  if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`) ?? {}

  try {
    const signals = await analyzeStrategy(strategy, thresholds)
    let sent = 0

    for (const signal of signals.slice(0, config.maxAlerts)) {
      const alertId = `${ENV_PREFIX}:alert:${strategy}:${signal.ticker}:${Date.now()}`
      const portfolio = 10000
      const positionSize = Math.round(portfolio * 0.15)

      const msg = formatAlert({
        ticker:       signal.ticker.replace('.pl', '').toUpperCase(),
        strategy:     config.label,
        price:        signal.price,
        signal:       signal.signal,
        target:       signal.target,
        stopLoss:     signal.stopLoss,
        portfolio,
        positionSize,
        shares:       Math.floor(positionSize / signal.price),
        description:  config.describe(signal),
        history:      'Dane historyczne w trakcie zbierania.',
        learning:     'Pierwsza analiza — brak wcześniejszych danych dla tej spółki.',
      })

      await sendTelegram(msg, IS_STAGING)

      await kv.set(alertId, {
        id: alertId,
        ticker: signal.ticker,
        strategy,
        signal: signal.signal,
        price: signal.price,
        target: signal.target,
        stopLoss: signal.stopLoss,
        timestamp: now.toISOString(),
        targetAchieved: null,
        thresholdsAtSignal: thresholds,
        ...config.kvExtra(signal),
      }, { ex: 90 * 24 * 60 * 60 })

      sent++
    }

    res.json({ signals: signals.length, sent })
  } catch (e) {
    console.error(`Cron ${strategy} error:`, e)
    res.status(500).json({ error: e.message })
  }
}
