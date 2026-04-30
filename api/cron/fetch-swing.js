import { analyzeStrategy } from '../../src/agents/signalAnalyzer.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return res.json({ skipped: 'weekend' })

  try {
    const signals = await analyzeStrategy('swing')
    let sent = 0

    for (const signal of signals.slice(0, 1)) { // max 1 per day
      const msg = formatAlert({
        ticker:       signal.ticker.replace('.pl', '').toUpperCase(),
        strategy:     '📈 Swing',
        price:        signal.price,
        signal:       signal.signal,
        target:       signal.target,
        stopLoss:     signal.stopLoss,
        portfolio:    10000,
        positionSize: 1500,
        shares:       Math.floor(1500 / signal.price),
        description:  `Cena przebiła SMA50 od dołu przy ponadprzeciętnym wolumenie (${signal.volumeMultiplier}x). Sygnał swing wzrostowy.`,
        history:      'Dane historyczne w trakcie zbierania.',
        learning:     'Pierwsza analiza — brak wcześniejszych danych dla tej spółki.',
      })

      await sendTelegram(msg, IS_STAGING)
      sent++
    }

    res.json({ signals: signals.length, sent })
  } catch (e) {
    console.error('Cron swing error:', e)
    res.status(500).json({ error: e.message })
  }
}
