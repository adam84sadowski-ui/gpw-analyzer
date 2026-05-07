function toStooqSymbol(ticker) {
  return ticker.replace(/\.pl$/i, '').toLowerCase()
}

export async function fetchCandlesStooq(ticker) {
  const symbol = toStooqSymbol(ticker)
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const csv = await res.text()
  if (!csv || csv.includes('No data') || !csv.includes(',')) return null
  const lines = csv.trim().split('\n')
  const candles = lines.slice(1).map(line => {
    const [date, open, high, low, close, volume] = line.split(',')
    return {
      date:   date?.trim(),
      open:   Math.round(parseFloat(open)  * 100) / 100,
      high:   Math.round(parseFloat(high)  * 100) / 100,
      low:    Math.round(parseFloat(low)   * 100) / 100,
      close:  Math.round(parseFloat(close) * 100) / 100,
      volume: parseInt(volume?.trim(), 10) || 0,
    }
  }).filter(c => c.date && !isNaN(c.close) && c.close > 0)
  if (candles.length < 25) return null
  return { candles: candles.slice(-252), shortName: symbol.toUpperCase() }
}
