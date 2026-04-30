const CACHE_TTL_MS = 25 * 60 * 1000
const cache = new Map()

function isFresh(ts) {
  return Date.now() - ts < CACHE_TTL_MS
}

function csvToRows(text) {
  const [header, ...lines] = text.trim().split('\n')
  const keys = header.split(',').map(k => k.trim())
  return lines
    .filter(l => l.trim())
    .map(l => {
      const vals = l.split(',')
      return Object.fromEntries(keys.map((k, i) => [k, vals[i]?.trim()]))
    })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { ticker, type = 'daily' } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  const cacheKey = `${type}_${ticker}`
  const hit = cache.get(cacheKey)
  if (hit && isFresh(hit.ts)) {
    return res.json(hit.data)
  }

  try {
    let url
    if (type === 'current' || type === 'index') {
      url = `https://stooq.com/q/l/?s=${ticker}&f=sd2t2ohlcv&h&e=csv`
    } else {
      url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!response.ok) {
      return res.status(502).json({ error: `Stooq error: ${response.status}` })
    }

    const text = await response.text()
    const rows = csvToRows(text)

    let data
    if (type === 'current' || type === 'index') {
      data = rows[0] ? {
        date:   rows[0].Date,
        open:   parseFloat(rows[0].Open),
        high:   parseFloat(rows[0].High),
        low:    parseFloat(rows[0].Low),
        close:  parseFloat(rows[0].Close),
        volume: parseInt(rows[0].Volume, 10),
      } : null
    } else {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - 12)
      data = rows
        .filter(r => r.Date && new Date(r.Date) >= cutoff)
        .map(r => ({
          date:   r.Date,
          open:   parseFloat(r.Open),
          high:   parseFloat(r.High),
          low:    parseFloat(r.Low),
          close:  parseFloat(r.Close),
          volume: parseInt(r.Volume, 10),
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    cache.set(cacheKey, { data, ts: Date.now() })
    res.json(data)
  } catch (e) {
    console.error('Stooq proxy error:', e)
    res.status(500).json({ error: e.message })
  }
}
