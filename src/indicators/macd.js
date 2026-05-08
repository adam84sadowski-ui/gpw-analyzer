function calcEMASeries(values, period) {
  const result = new Array(values.length).fill(null)
  if (values.length < period) return result
  const k = 2 / (period + 1)
  result[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

export function calculateMACD(prices) {
  const ema12 = calcEMASeries(prices, 12)
  const ema26 = calcEMASeries(prices, 26)

  const macdLine = prices.map((_, i) =>
    ema12[i] != null && ema26[i] != null
      ? Math.round((ema12[i] - ema26[i]) * 10000) / 10000
      : null,
  )

  const macdValues = macdLine.filter(v => v != null)
  const signalRaw  = calcEMASeries(macdValues, 9)

  const signal = new Array(prices.length).fill(null)
  let idx = 0
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] != null) { signal[i] = signalRaw[idx] ?? null; idx++ }
  }

  const histogram = prices.map((_, i) =>
    macdLine[i] != null && signal[i] != null
      ? Math.round((macdLine[i] - signal[i]) * 10000) / 10000
      : null,
  )

  return { macdLine, signal, histogram }
}

export function getMACDSignal(macd) {
  const { macdLine, signal, histogram } = macd
  const last = macdLine.length - 1
  let score = 0

  const m0 = macdLine[last], s0 = signal[last]
  const m1 = macdLine[last - 1], s1 = signal[last - 1]
  if (m0 != null && s0 != null && m1 != null && s1 != null) {
    if (m1 <= s1 && m0 > s0) score += 10
    if (m1 >= s1 && m0 < s0) score -= 10
  }

  const h0 = histogram[last], h1 = histogram[last - 1]
  if (h0 != null && h1 != null) {
    if (h0 > h1) score += 5
    if (h0 < h1) score -= 5
  }

  return {
    score,
    macdLine:  m0,
    signalLine: s0,
    histogram:  h0,
    trend: m0 != null && s0 != null ? (m0 > s0 ? 'bullish' : 'bearish') : null,
  }
}
