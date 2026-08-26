import { createClient } from '@vercel/kv'
import { runLearningAgent, formatWeeklyReport } from '../../src/agents/learningAgent.js'
import { buildPositionReport, generateAlertReport } from '../../src/agents/reportGenerator.js'
import { sendTelegram } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV_PREFIX = IS_STAGING ? 'staging' : 'prod'
const MIN_CLOSED_POSITIONS = 5

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  // ── Fetch all positions ───────────────────────────────────────────────────
  const positionKeys = await kv.keys(`${ENV_PREFIX}:position:*`).catch(() => [])
  const allPositions = positionKeys.length
    ? (await Promise.all(positionKeys.map(k => kv.get(k).catch(() => null)))).filter(Boolean)
    : []

  const closedPositions = allPositions.filter(p =>
    p?.status === 'closed' && p?.exitPrice != null && p?.entryPrice != null
  )
  const openPositions = allPositions.filter(p => p?.status === 'open')

  // ── Guard: minimum closed positions for meaningful stats ──────────────────
  if (closedPositions.length < MIN_CLOSED_POSITIONS) {
    await sendTelegram(
      `🧠 Learning Agent: za mało zamkniętych pozycji (${closedPositions.length}/${MIN_CLOSED_POSITIONS} wymaganych). Raport pominięty.`,
      IS_STAGING
    )
    return res.json({ skipped: 'insufficient_closed_positions', closed: closedPositions.length, open: openPositions.length })
  }

  // ── Alert count (informational only — not used for stats) ────────────────
  const alertKeys  = await kv.keys(`${ENV_PREFIX}:alert:*`).catch(() => [])
  const totalAlerts = alertKeys.length

  try {
    // ── Build position report (no Claude needed for this) ─────────────────
    const posReport = buildPositionReport(closedPositions, openPositions)

    // ── Run Learning Agent (Claude analysis) ─────────────────────────────
    const aiResult = await runLearningAgent(closedPositions, openPositions)

    // ── Create GitHub issue for threshold recommendations ─────────────────
    if (aiResult?.threshold_recommendations && (aiResult.recommendation_confidence ?? 0) >= 60) {
      await createThresholdIssue(aiResult, posReport).catch(err => {
        console.warn('GitHub issue creation failed:', err.message)
      })
    }

    // ── Save analysis snapshot to KV (NOT the thresholds — for audit trail) ─
    await kv.set(`${ENV_PREFIX}:learning:last_report`, {
      generatedAt:              new Date().toISOString(),
      closedPositions:          closedPositions.length,
      openPositions:            openPositions.length,
      perStrategy:              posReport.perStrategy,
      aiInsights:               aiResult?.insights ?? null,
      aiLossPattern:            aiResult?.loss_pattern ?? null,
      thresholdRecommendations: aiResult?.threshold_recommendations ?? null,
      recommendationConfidence: aiResult?.recommendation_confidence ?? null,
    }, { ex: 8 * 24 * 60 * 60 }).catch(() => {})

    // ── Format and send Telegram ──────────────────────────────────────────
    const msg = formatWeeklyReport({ posReport, aiResult, totalAlerts })
    await sendTelegram(msg, IS_STAGING)

    res.json({
      success:        true,
      closedPositions: closedPositions.length,
      openPositions:  openPositions.length,
      perStrategy:    posReport.perStrategy,
      aiConfidence:   aiResult?.recommendation_confidence ?? null,
    })
  } catch (e) {
    console.error('Learning weekly error:', e)
    await sendTelegram(`🧠 Learning Agent: błąd\n<code>${e.message}</code>`, IS_STAGING).catch(() => {})
    res.status(500).json({ error: e.message })
  }
}

async function createThresholdIssue(aiResult, posReport) {
  const token = process.env.GITHUB_TOKEN
  if (!token) return  // skip silently if no token configured

  const rec = aiResult.threshold_recommendations
  const lines = []
  for (const [exch, vals] of Object.entries(rec)) {
    const parts = Object.entries(vals).filter(([, v]) => v != null).map(([k, v]) => `- ${k}: ${v}`)
    if (parts.length) lines.push(`**${exch}:**\n${parts.join('\n')}`)
  }

  const stratSummary = Object.entries(posReport.perStrategy)
    .map(([s, d]) => `- ${s}: ${d.wins}W/${d.losses}L (${d.winRate}%) | śr. zysk: ${d.avgWin ?? '—'}% | śr. strata: ${d.avgLoss ?? '—'}%`)
    .join('\n')

  const body = `## Rekomendacja Learning Agenta

**Data:** ${new Date().toISOString().slice(0, 10)}
**Pewność AI:** ${aiResult.recommendation_confidence}%
**Zamkniętych pozycji w analizie:** ${posReport.totalClosed}

## Wyniki per-strategia (podstawa rekomendacji)
${stratSummary}

## Rekomendowane korekty progów
${lines.join('\n\n') || 'Brak konkretnych zmian.'}

## Wniosek AI
${aiResult.insights ?? '—'}

## Wzorzec strat
${aiResult.loss_pattern ?? '—'}

## Kryteria akceptacji
- [ ] PO zatwierdził rekomendację
- [ ] Developer zaktualizował SIGNAL_DEFAULTS w signals.js
- [ ] Testy przechodzą po zmianie
- [ ] Deploy na staging + QA

> Wygenerowano automatycznie przez Learning Agent. Wymaga zatwierdzenia przed wdrożeniem.`

  await fetch('https://api.github.com/repos/adam84sadowski-ui/gpw-analyzer/issues', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/vnd.github+json',
    },
    body: JSON.stringify({
      title:  `learning: rekomendacja kalibracji progów ${new Date().toISOString().slice(0, 10)}`,
      body,
      labels: ['learning', 'Learning-Agent'],
    }),
  })
}
