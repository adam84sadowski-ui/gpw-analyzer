const CACHE_TTL_MS = 25 * 60 * 1000 // 25 minutes
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

export async function fetchIndex(ticker) {
  // ticker e.g. "wig20.pl"
  const key = `idx_${ticker}`
  const hit = cache.get(key)
  if (hit && isFresh(hit.ts)) return hit.data

  const url = `https://stooq.com/q/l/?s=${ticker}&f=sd2t2ohlcv&h&e=csv`
  const res = await fetch(url)
  const text = await res.text()
  const rows = csvToRows(text)
  const data = rows[0] ?? null

  cache.set(key, { data, ts: Date.now() })
  return data
}

export async function fetchDaily(ticker, months = 12) {
  // ticker e.g. "pkn.pl"
  const key = `daily_${ticker}`
  const hit = cache.get(key)
  if (hit && isFresh(hit.ts)) return hit.data

  const url = `https://stooq.com/q/d/l/?s=${ticker}&i=d`
  const res = await fetch(url)
  const text = await res.text()
  const rows = csvToRows(text)

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const data = rows
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

  cache.set(key, { data, ts: Date.now() })
  return data
}

export async function fetchCurrent(ticker) {
  const key = `cur_${ticker}`
  const hit = cache.get(key)
  if (hit && isFresh(hit.ts)) return hit.data

  const url = `https://stooq.com/q/l/?s=${ticker}&f=sd2t2ohlcv&h&e=csv`
  const res = await fetch(url)
  const text = await res.text()
  const rows = csvToRows(text)
  const data = rows[0] ? {
    date:   rows[0].Date,
    open:   parseFloat(rows[0].Open),
    high:   parseFloat(rows[0].High),
    low:    parseFloat(rows[0].Low),
    close:  parseFloat(rows[0].Close),
    volume: parseInt(rows[0].Volume, 10),
  } : null

  cache.set(key, { data, ts: Date.now() })
  return data
}
