import { createClient } from '@vercel/kv'

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  const symbol = ticker.toLowerCase().replace(/\.pl$/, '').toUpperCase() + '.WA'
  const kvKey  = `${ENV}:eodhd:${symbol}`

  const cached = await kv.get(kvKey).catch(() => null)
  if (cached) return res.json(cached)

  const key = process.env.EODHD_API_KEY
  if (!key) return res.json({ pe: null, dividendYield: null })

  try {
    const url = `https://eodhd.com/api/fundamentals/${symbol}?api_token=${key}&fmt=json&filter=Highlights::PERatio,Highlights::DividendYield`
    const r = await fetch(url)
    if (!r.ok) return res.json({ pe: null, dividendYield: null })
    const d = await r.json()
    const result = {
      pe:            d?.PERatio          ? Math.round(d.PERatio * 10) / 10 : null,
      dividendYield: d?.DividendYield    ? Math.round(d.DividendYield * 1000) / 10 : null,
    }
    await kv.set(kvKey, result, { ex: 24 * 60 * 60 }).catch(() => {})
    res.json(result)
  } catch {
    res.json({ pe: null, dividendYield: null })
  }
}
