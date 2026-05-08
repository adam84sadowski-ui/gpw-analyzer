function calcRSISeries(closes, period = 14) {
  const result = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return result
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  let avgGain = gains / period, avgLoss = losses / period
  result[period] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    result[i] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100
  }
  return result
}

function findExtrema(values, type, lookback = 3, window = 40) {
  const extrema = []
  const start = Math.max(lookback, values.length - window - lookback)
  for (let i = start; i < values.length - lookback; i++) {
    if (values[i] == null) continue
    let isExtrema = true
    for (let j = 1; j <= lookback; j++) {
      if (values[i - j] == null || values[i + j] == null) { isExtrema = false; break }
      if (type === 'min' && (values[i] >= values[i - j] || values[i] >= values[i + j])) { isExtrema = false; break }
      if (type === 'max' && (values[i] <= values[i - j] || values[i] <= values[i + j])) { isExtrema = false; break }
    }
    if (isExtrema) extrema.push(i)
  }
  return extrema
}

export function detectRSIDivergence(closes, period = 14) {
  if (closes.length < 40) return null
  const rsiSeries = calcRSISeries(closes, period)
  const TOL = 0.005

  // Bullish: price lower low, RSI higher low
  const troughs = findExtrema(closes, 'min')
  if (troughs.length >= 2) {
    const [i1, i2] = troughs.slice(-2)
    const r1 = rsiSeries[i1], r2 = rsiSeries[i2]
    if (r1 != null && r2 != null
        && closes[i2] < closes[i1] * (1 - TOL)
        && r2 > r1 * (1 + TOL)) return 'bullish'
  }

  // Bearish: price higher high, RSI lower high
  const peaks = findExtrema(closes, 'max')
  if (peaks.length >= 2) {
    const [i1, i2] = peaks.slice(-2)
    const r1 = rsiSeries[i1], r2 = rsiSeries[i2]
    if (r1 != null && r2 != null
        && closes[i2] > closes[i1] * (1 + TOL)
        && r2 < r1 * (1 - TOL)) return 'bearish'
  }

  return null
}
