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
