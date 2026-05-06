import { createClient } from '@vercel/kv'

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const limit    = Math.min(parseInt(req.query.limit ?? '20', 10), 100)
  const strategy = req.query.strategy ?? ''
  const ticker   = req.query.ticker   ?? ''

  try {
    let cursor = 0
    const keys = []
    let iterations = 0
    do {
      const [next, batch] = await kv.scan(cursor, { match: `${ENV}:alert:*`, count: 100 })
      keys.push(...batch)
      cursor = Number(next)
      iterations++
    } while (cursor !== 0 && iterations < 50)

    const records = await Promise.all(keys.map(k => kv.get(k).catch(() => null)))

    const alerts = records
      .filter(Boolean)
      .filter(a => !strategy || a.strategy === strategy)
      .filter(a => !ticker   || (a.ticker ?? '').toUpperCase().includes(ticker.toUpperCase()))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)

    res.json(alerts)
  } catch {
    res.json([])
  }
}
