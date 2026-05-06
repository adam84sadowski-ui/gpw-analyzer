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

  const symbol = ticker.toLowerCase().replace(/\.pl$/, '').toUpperCase() + '.WAR'
  const kvKey  = `${ENV}:eodhd:v6:${symbol}`

  const cached = await kv.get(kvKey).catch(() => null)
  if (cached) return res.json(cached)

  const key = process.env.EODHD_API_KEY
  if (!key) return res.json({ pe: null, dividendYield: null })

  try {
    const today   = new Date().toISOString().slice(0, 10)
    const from12m = new Date(Date.now() - 395 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const cutoff  = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [divRes, eodRes] = await Promise.all([
      fetch(`https://eodhd.com/api/div/${symbol}?api_token=${key}&fmt=json&from=${from12m}`),
      fetch(`https://eodhd.com/api/eod/${symbol}?api_token=${key}&fmt=json&limit=1&order=d`),
    ])

    const [divData, eodData] = await Promise.all([
      divRes.ok ? divRes.json() : [],
      eodRes.ok ? eodRes.json() : [],
    ])

    const currentPrice = eodData?.[0]?.close ?? null

    // trailing 12-month dividends (ex-date <= today, ex-date >= cutoff)
    const annualDiv = Array.isArray(divData)
      ? divData
          .filter(d => d.date >= cutoff && d.date <= today)
          .reduce((sum, d) => sum + (d.value ?? 0), 0)
      : 0

    const div = (currentPrice && annualDiv > 0)
      ? annualDiv / currentPrice
      : null

    const result = {
      pe:            null,  // requires EODHD paid plan (fundamentals)
      dividendYield: div ? Math.round(div * 1000) / 10 : null,
    }

    if (result.dividendYield !== null) {
      await kv.set(kvKey, result, { ex: 24 * 60 * 60 }).catch(() => {})
    }
    res.json(result)
  } catch {
    res.json({ pe: null, dividendYield: null })
  }
}
