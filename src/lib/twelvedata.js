export async function fetchCandlesTwelveData(ticker) {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return null
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=252&apikey=${key}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  if (data.status === 'error' || !Array.isArray(data.values) || !data.values.length) return null
  const candles = [...data.values].reverse().map(v => ({
    date:   v.datetime,
    open:   Math.round(parseFloat(v.open)   * 100) / 100,
    high:   Math.round(parseFloat(v.high)   * 100) / 100,
    low:    Math.round(parseFloat(v.low)    * 100) / 100,
    close:  Math.round(parseFloat(v.close)  * 100) / 100,
    volume: parseInt(v.volume, 10) || 0,
  })).filter(c => !isNaN(c.close) && c.close > 0)
  if (candles.length < 25) return null
  return { candles, shortName: data.meta?.name ?? ticker }
}

export async function fetchCurrentTwelveData(ticker) {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) return null
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(ticker)}&apikey=${key}`
  const res = await fetch(url)
  if (!res.ok) return null
  const d = await res.json()
  if (d.status === 'error' || !d.close) return null
  return {
    close:     Math.round(parseFloat(d.close)  * 100) / 100,
    open:      Math.round(parseFloat(d.open)   * 100) / 100,
    high:      Math.round(parseFloat(d.high)   * 100) / 100,
    low:       Math.round(parseFloat(d.low)    * 100) / 100,
    volume:    parseInt(d.volume, 10) || null,
    date:      d.datetime ?? new Date().toISOString().slice(0, 10),
    Close:     d.close ?? 'N/D',
    Open:      d.open  ?? 'N/D',
    shortName: d.name  ?? ticker,
  }
}
