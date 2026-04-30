import { createClient } from '@vercel/kv'
import { analyzeStrategy } from '../../src/agents/signalAnalyzer.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV_PREFIX = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const now = new Date()
  if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`) ?? {}

  try {
    const signals = await analyzeStrategy('aggressive', thresholds)
    let sent = 0

    for (const signal of signals.slice(0, 2)) {
      const alertId = `${ENV_PREFIX}:alert:aggressive:${signal.ticker}:${Date.now()}`
      const portfolio = 10000
      const positionSize = Math.round(portfolio * 0.15)

      const msg = formatAlert({
        ticker:       signal.ticker.replace('.pl', '').toUpperCase(),
        strategy:     '🚀 Agresywna',
        price:        signal.price,
        signal:       signal.signal,
        target:       signal.target,
        stopLoss:     signal.stopLoss,
        portfolio,
        positionSize,
        shares:       Math.floor(positionSize / signal.price),
        description:  `Breakout powyżej max 20 dni, RSI ${signal.rsi}, wolumen ${signal.volumeMultiplier}x. Sygnał momentum. ⚠️ WYSOKO RYZYKOWNA SPÓŁKA.`,
        history:      'Dane historyczne w trakcie zbierania.',
        learning:     'Pierwsza analiza — brak wcześniejszych danych dla tej spółki.',
      })

      await sendTelegram(msg, IS_STAGING)

      await kv.set(alertId, {
        id: alertId,
        ticker: signal.ticker,
        strategy: 'aggressive',
        signal: signal.signal,
        price: signal.price,
        rsi: signal.rsi,
        target: signal.target,
        stopLoss: signal.stopLoss,
        timestamp: now.toISOString(),
        targetAchieved: null,
        thresholdsAtSignal: thresholds,
      }, { ex: 90 * 24 * 60 * 60 })

      sent++
    }

    res.json({ signals: signals.length, sent })
  } catch (e) {
    console.error('Cron aggressive error:', e)
    res.status(500).json({ error: e.message })
  }
}
