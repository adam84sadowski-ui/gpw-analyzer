import { createClient } from '@vercel/kv'
import { runLearningAgent, formatWeeklyReport } from '../../src/agents/learningAgent.js'
import { generateAlertReport } from '../../src/agents/reportGenerator.js'
import { sendTelegram } from '../../src/services/telegram.js'

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

  // Pobierz alerty z ostatnich 30 dni
  const alertKeys = await kv.keys(`${ENV_PREFIX}:alert:*`)
  const alertHistory = alertKeys.length
    ? await Promise.all(alertKeys.map(k => kv.get(k)))
    : []

  const recent = alertHistory.filter(a => {
    if (!a?.timestamp) return false
    return Date.now() - new Date(a.timestamp).getTime() < 30 * 24 * 60 * 60 * 1000
  })

  if (recent.length < 5) {
    await sendTelegram(
      '🧠 Learning Agent: za mało danych (min. 5 alertów). Raport tygodniowy pominięty.',
      IS_STAGING
    )
    return res.json({ skipped: 'insufficient_data', count: recent.length })
  }

  try {
    const report = generateAlertReport(recent)
    const newThresholds = await runLearningAgent(recent)

    // Zapisz nowe progi w KV
    await kv.set(`${ENV_PREFIX}:thresholds`, newThresholds)

    const msg = formatWeeklyReport({
      scalping:      report.byStrategy.scalping   ?? { hit: 0, total: 0 },
      swing:         report.byStrategy.swing      ?? { hit: 0, total: 0 },
      aggressive:    report.byStrategy.aggressive ?? { hit: 0, total: 0 },
      bestStock:     report.bestStock,
      worstStock:    report.worstStock,
      newThresholds: {
        rsiOld: 30, rsiNew: newThresholds.rsi_threshold,
        volOld: 2,  volNew: newThresholds.volume_multiplier,
        smaBuffer: newThresholds.sma_buffer_percent,
      },
      insights:     newThresholds.insights,
      focusTickers: report.focusTickers,
    })

    await sendTelegram(msg, IS_STAGING)
    res.json({ success: true, newThresholds })
  } catch (e) {
    console.error('Learning weekly error:', e)
    await sendTelegram(`🧠 Learning Agent: błąd tygodniowego raportu\n<code>${e.message}</code>`, IS_STAGING).catch(() => {})
    res.status(500).json({ error: e.message })
  }
}
