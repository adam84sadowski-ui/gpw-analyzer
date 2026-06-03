import { createClient } from '@vercel/kv'
import { fetchCurrent } from '../src/lib/yahoo.js'

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  const { method } = req

  if (method === 'POST') {
    const { ticker, exchange, strategy, signal, priceAtAnalysis,
            entryZoneMin, entryZoneMax, stopLoss, target,
            aiDecision, aiSummary, aiRecommendation, buffettScore, confidence,
            reviewDays } = req.body
    if (!ticker || !aiDecision) return res.status(400).json({ error: 'ticker and aiDecision required' })

    const ts = Date.now()
    const id = `${ENV}:watch:${ticker}:${ts}`
    const reviewDate = reviewDays
      ? new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null

    const item = {
      id, ticker, exchange: exchange ?? 'NYSE', strategy, signal,
      priceAtAnalysis, entryZoneMin: entryZoneMin ?? null, entryZoneMax: entryZoneMax ?? null,
      stopLoss, target, aiDecision, aiSummary, aiRecommendation,
      buffettScore, confidence, reviewDate,
      createdAt: new Date().toISOString(),
      status: 'active',
    }
    await kv.set(id, item, { ex: 60 * 24 * 60 * 60 }) // 60 days TTL
    return res.json(item)
  }

  if (method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    await kv.del(id)
    return res.json({ deleted: id })
  }

  if (method === 'GET') {
    let cursor = 0
    const items = []
    do {
      const [next, keys] = await kv.scan(cursor, { match: `${ENV}:watch:*`, count: 100 })
      cursor = Number(next)
      if (keys.length) {
        const vals = await Promise.all(keys.map(k => kv.get(k).catch(() => null)))
        items.push(...vals.filter(Boolean))
      }
    } while (cursor !== 0)

    // Fetch live prices for active items
    const active = items.filter(w => w.status === 'active')
    const livePrices = await Promise.allSettled(
      active.map(w => fetchCurrent(w.ticker, w.exchange).catch(() => null))
    )
    active.forEach((w, i) => {
      const p = livePrices[i].status === 'fulfilled' ? livePrices[i].value : null
      w.livePrice = p?.close ?? null
      // Auto-expire past reviewDate + 3 days
      if (w.reviewDate) {
        const expiry = new Date(w.reviewDate)
        expiry.setDate(expiry.getDate() + 3)
        if (new Date() > expiry) w.status = 'expired'
      }
    })

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return res.json(items)
  }

  return res.status(405).end()
}
