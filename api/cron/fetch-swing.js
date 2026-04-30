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

  // Pobierz aktualne progi z KV (Learning Agent może je zmienić)
  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`) ?? {}

  try {
    const signals = await analyzeStrategy('swing', thresholds)
    let sent = 0

    for (const signal of signals.slice(0, 1)) {
      const alertId = `${ENV_PREFIX}:alert:swing:${signal.ticker}:${Date.now()}`
      const portfolio = 10000
      const positionSize = Math.round(portfolio * 0.15)

      const msg = formatAlert({
        ticker:       signal.ticker.replace('.pl', '').toUpperCase(),
        strategy:     '📈 Swing',
        price:        signal.price,
        signal:       signal.signal,
        target:       signal.target,
        stopLoss:     signal.stopLoss,
        portfolio,
        positionSize,
        shares:       Math.floor(positionSize / signal.price),
        description:  `Cena przebiła SMA50 od dołu przy ponadprzeciętnym wolumenie (${signal.volumeMultiplier}x). Sygnał swing wzrostowy.`,
        history:      'Dane historyczne w trakcie zbierania.',
        learning:     'Pierwsza analiza — brak wcześniejszych danych dla tej spółki.',
      })

      await sendTelegram(msg, IS_STAGING)

      // Zapisz alert do KV
      await kv.set(alertId, {
        id: alertId,
        ticker: signal.ticker,
        strategy: 'swing',
        signal: signal.signal,
        price: signal.price,
        target: signal.target,
        stopLoss: signal.stopLoss,
        timestamp: now.toISOString(),
        targetAchieved: null,
        thresholdsAtSignal: thresholds,
      }, { ex: 90 * 24 * 60 * 60 }) // 90 dni TTL

      sent++
    }

    res.json({ signals: signals.length, sent })
  } catch (e) {
    console.error('Cron swing error:', e)
    res.status(500).json({ error: e.message })
  }
}
