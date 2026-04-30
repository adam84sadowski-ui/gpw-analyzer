const CACHE_TTL_MS = 25 * 60 * 1000
const cache = new Map()

function isFresh(ts) {
  return Date.now() - ts < CACHE_TTL_MS
}

// "pkn.pl" → "PKN.WA", "wig20.pl" → "WIG20.WA"
function toYahooTicker(ticker) {
  return ticker.replace(/\.pl$/i, '').toUpperCase() + '.WA'
}

async function fetchYahooChart(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}&includePrePost=false`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`)
  return res.json()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { ticker, type = 'daily' } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  const cacheKey = `${type}_${ticker}`
  const hit = cache.get(cacheKey)
  if (hit && isFresh(hit.ts)) return res.json(hit.data)

  try {
    const symbol = toYahooTicker(ticker)

    if (type === 'current' || type === 'index') {
      const json = await fetchYahooChart(symbol, '5d')
      const result = json?.chart?.result?.[0]
      if (!result) return res.json(null)

      const meta = result.meta
      const data = {
        date:   new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10),
        open:   meta.regularMarketOpen ?? null,
        high:   meta.regularMarketDayHigh ?? null,
        low:    meta.regularMarketDayLow ?? null,
        close:  meta.regularMarketPrice ?? null,
        volume: meta.regularMarketVolume ?? null,
        Open:   String(meta.regularMarketOpen ?? 'N/D'),
        High:   String(meta.regularMarketDayHigh ?? 'N/D'),
        Low:    String(meta.regularMarketDayLow ?? 'N/D'),
        Close:  String(meta.regularMarketPrice ?? 'N/D'),
        Volume: String(meta.regularMarketVolume ?? 'N/D'),
      }
      cache.set(cacheKey, { data, ts: Date.now() })
      return res.json(data)
    }

    // daily historical
    const json = await fetchYahooChart(symbol, '1y')
    const result = json?.chart?.result?.[0]
    if (!result) return res.json([])

    const timestamps = result.timestamp ?? []
    const q = result.indicators.quote[0]

    const data = timestamps
      .map((ts, i) => ({
        date:   new Date(ts * 1000).toISOString().slice(0, 10),
        open:   q.open[i]   ? Math.round(q.open[i]   * 100) / 100 : null,
        high:   q.high[i]   ? Math.round(q.high[i]   * 100) / 100 : null,
        low:    q.low[i]    ? Math.round(q.low[i]    * 100) / 100 : null,
        close:  q.close[i]  ? Math.round(q.close[i]  * 100) / 100 : null,
        volume: q.volume[i] ?? null,
      }))
      .filter(c => c.close !== null)

    cache.set(cacheKey, { data, ts: Date.now() })
    res.json(data)
  } catch (e) {
    console.error('Yahoo Finance proxy error:', e)
    res.status(500).json({ error: e.message })
  }
}
