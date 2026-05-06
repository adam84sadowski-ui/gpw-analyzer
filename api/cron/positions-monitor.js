import { createClient } from '@vercel/kv'
import { fetchCurrent } from '../../src/lib/yahoo.js'
import { sendTelegram } from '../../src/services/telegram.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const MAX_DAYS = { scalping: 5, swing: 40, aggressive: 30 }
const TARGET_ALERT_THRESHOLD = 0.8   // alert at 80% of target
const STOP_ALERT_THRESHOLD   = 0.8   // alert at 80% of stop loss

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const keys = await kv.keys(`${ENV}:position:*`).catch(() => [])
  if (!keys.length) return res.json({ checked: 0, alerts: 0 })

  const positions = (await Promise.all(keys.map(k => kv.get(k).catch(() => null))))
    .filter(p => p && p.status === 'open')

  let alertsSent = 0

  for (const pos of positions) {
    try {
      const exchange = pos.exchange ?? 'GPW'
      const currency = exchange === 'NYSE' ? 'USD' : 'PLN'
      const current = await fetchCurrent(pos.ticker, exchange)
      if (!current?.close) continue

      const price      = current.close
      const pnlPct     = (price - pos.entryPrice) / pos.entryPrice
      const targetFrac = pos.target / 100
      const stopFrac   = pos.stopLoss / 100
      const daysHeld   = Math.floor((Date.now() - new Date(pos.entryDate)) / 86400000)
      const maxDays    = MAX_DAYS[pos.strategy] ?? 30

      // Dedup keys — skip if already alerted today
      const dedup = async (type) => {
        const key = `${ENV}:pos-alert:${pos.id}:${type}`
        const exists = await kv.get(key).catch(() => null)
        if (exists) return true
        await kv.set(key, 1, { ex: 23 * 60 * 60 }).catch(() => {})
        return false
      }

      const ticker = pos.tickerDisplay ?? pos.ticker.replace('.pl','').toUpperCase()

      if (pnlPct >= targetFrac * TARGET_ALERT_THRESHOLD) {
        if (!(await dedup('target'))) {
          const pct = (pnlPct * 100).toFixed(1)
          const targetPct = pos.target
          await sendTelegram(
            `🎯 <b>CEL BLISKO — ${ticker}</b>\n\nP&L: +${pct}% z celem +${targetPct}%\nCena: ${price} ${currency}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>\n\n<i>Rozważ realizację zysku.</i>`,
            IS_STAGING
          )
          alertsSent++
        }
      } else if (pnlPct <= -(stopFrac * STOP_ALERT_THRESHOLD)) {
        if (!(await dedup('stop'))) {
          const pct = (pnlPct * 100).toFixed(1)
          const stopPct = pos.stopLoss
          await sendTelegram(
            `🛑 <b>STOP LOSS BLISKO — ${ticker}</b>\n\nP&L: ${pct}% przy stop -${stopPct}%\nCena: ${price} ${currency}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>\n\n<i>Rozważ zamknięcie pozycji.</i>`,
            IS_STAGING
          )
          alertsSent++
        }
      }

      if (daysHeld > maxDays) {
        if (!(await dedup('horizon'))) {
          await sendTelegram(
            `⏰ <b>HORYZONT PRZEKROCZONY — ${ticker}</b>\n\nPozycja otwarta ${daysHeld} dni (max ${maxDays} dla ${pos.strategy}).\nP&L: ${(pnlPct*100).toFixed(1)}%\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>\n\n<i>Rozważ zamknięcie pozycji.</i>`,
            IS_STAGING
          )
          alertsSent++
        }
      }
    } catch (e) {
      console.error(`positions-monitor: error for ${pos.ticker}:`, e.message)
    }
  }

  res.json({ checked: positions.length, alerts: alertsSent })
}
