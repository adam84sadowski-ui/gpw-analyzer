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
  const alertKeys = await kv.keys(`${ENV_PREFIX}:alert:*`).catch(() => [])
  const alertHistory = alertKeys.length
    ? (await Promise.all(alertKeys.map(k => kv.get(k).catch(() => null)))).filter(Boolean)
    : []

  const recent = alertHistory.filter(a => {
    if (!a?.timestamp) return false
    return Date.now() - new Date(a.timestamp).getTime() < 30 * 24 * 60 * 60 * 1000
  })

  // Pobierz zamknięte pozycje — główne źródło wiedzy o stratach/zyskach
  const positionKeys = await kv.keys(`${ENV_PREFIX}:position:*`).catch(() => [])
  const allPositions = positionKeys.length
    ? (await Promise.all(positionKeys.map(k => kv.get(k).catch(() => null)))).filter(Boolean)
    : []
  const closedPositions = allPositions.filter(p =>
    p?.status === 'closed' && p?.exitPrice && p?.entryPrice
  )

  const totalData = recent.length + closedPositions.length

  if (totalData < 2) {
    await sendTelegram(
      `🧠 Learning Agent: za mało danych (${recent.length} alertów, ${closedPositions.length} zamkniętych pozycji). Raport pominięty.`,
      IS_STAGING
    )
    return res.json({ skipped: 'insufficient_data', alerts: recent.length, positions: closedPositions.length })
  }

  try {
    const report       = generateAlertReport(recent)
    const newThresholds = await runLearningAgent(recent, closedPositions)

    // Zapisz per-exchange progi w KV (backward compatible — zachowaj też flat format)
    const thresholdsToSave = {
      GPW:  newThresholds.GPW  ?? { rsi_threshold: 30, volume_multiplier: 1.5,  sma_buffer_percent: 0 },
      NYSE: newThresholds.NYSE ?? { rsi_threshold: 32, volume_multiplier: 1.15, sma_buffer_percent: 0 },
      // flat fallback dla backward compat z fetch.js
      rsi_threshold:     newThresholds.NYSE?.rsi_threshold ?? 32,
      volume_multiplier: newThresholds.NYSE?.volume_multiplier ?? 1.15,
      sma_buffer_percent: 0,
      insights:          newThresholds.insights,
      updated_at:        new Date().toISOString(),
    }
    await kv.set(`${ENV_PREFIX}:thresholds`, thresholdsToSave)

    // Statystyki pozycji
    const winners  = closedPositions.filter(p => (p.exitPrice - p.entryPrice) / p.entryPrice > 0)
    const losers   = closedPositions.filter(p => (p.exitPrice - p.entryPrice) / p.entryPrice < 0)
    const avgWin   = winners.length
      ? Math.round(winners.reduce((s, p) => s + (p.exitPrice - p.entryPrice) / p.entryPrice * 100, 0) / winners.length * 10) / 10
      : null
    const avgLoss  = losers.length
      ? Math.round(losers.reduce((s, p) => s + (p.exitPrice - p.entryPrice) / p.entryPrice * 100, 0) / losers.length * 10) / 10
      : null

    // AI accuracy from lifecycle outcomes
    const lifecycleKeys = await kv.keys(`${ENV_PREFIX}:lifecycle:*`).catch(() => [])
    const lifecycles    = lifecycleKeys.length
      ? (await Promise.all(lifecycleKeys.map(k => kv.get(k).catch(() => null)))).filter(Boolean)
      : []
    const withOutcomes = lifecycles.filter(lc => lc?.aiEntry && lc?.aiOutcomes?.length)
    const aiHit        = withOutcomes.filter(lc => lc.aiOutcomes[lc.aiOutcomes.length - 1]?.hit).length
    const aiTotal      = withOutcomes.length

    const gpwOld  = 30, nyseOld = 32
    const msg = formatWeeklyReport({
      scalping:      report.byStrategy.scalping   ?? { hit: 0, total: 0 },
      swing:         report.byStrategy.swing      ?? { hit: 0, total: 0 },
      aggressive:    report.byStrategy.aggressive ?? { hit: 0, total: 0 },
      bestStock:     report.bestStock,
      worstStock:    report.worstStock,
      newThresholds: {
        gpwRsiOld:  gpwOld,
        gpwRsiNew:  thresholdsToSave.GPW.rsi_threshold,
        gpwVolNew:  thresholdsToSave.GPW.volume_multiplier,
        nyseRsiOld: nyseOld,
        nyseRsiNew: thresholdsToSave.NYSE.rsi_threshold,
        nyseVolNew: thresholdsToSave.NYSE.volume_multiplier,
      },
      insights:     newThresholds.insights,
      lossPattern:  newThresholds.loss_pattern ?? null,
      focusTickers: report.focusTickers,
      aiHit,
      aiTotal,
      positionStats: { winners: winners.length, losers: losers.length, avgWin, avgLoss },
    })

    await sendTelegram(msg, IS_STAGING)
    res.json({ success: true, newThresholds: thresholdsToSave, positions: closedPositions.length, alerts: recent.length })
  } catch (e) {
    console.error('Learning weekly error:', e)
    await sendTelegram(`🧠 Learning Agent: błąd\n<code>${e.message}</code>`, IS_STAGING).catch(() => {})
    res.status(500).json({ error: e.message })
  }
}
