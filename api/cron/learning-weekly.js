import { runLearningAgent, formatWeeklyReport } from '../../src/agents/learningAgent.js'
import { generateAlertReport } from '../../src/agents/reportGenerator.js'
import { sendTelegram } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  // TODO: fetch last 30 days of alerts from KV
  const alertHistory = []

  if (alertHistory.length < 5) {
    await sendTelegram(
      '🧠 Learning Agent: za mało danych (min. 5 alertów). Raport tygodniowy pominięty.',
      IS_STAGING
    )
    return res.json({ skipped: 'insufficient_data' })
  }

  try {
    const report = generateAlertReport(alertHistory)
    const newThresholds = await runLearningAgent(alertHistory)

    // TODO: save newThresholds to KV

    const msg = formatWeeklyReport({
      scalping:     report.byStrategy.scalping   ?? { hit: 0, total: 0 },
      swing:        report.byStrategy.swing      ?? { hit: 0, total: 0 },
      aggressive:   report.byStrategy.aggressive ?? { hit: 0, total: 0 },
      bestStock:    report.bestStock,
      worstStock:   report.worstStock,
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
    res.status(500).json({ error: e.message })
  }
}
