export function calcSMA(closes, period) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

export function calcSMASeries(closes, period) {
  const result = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      const slice = closes.slice(i - period + 1, i + 1)
      result.push(slice.reduce((a, b) => a + b, 0) / period)
    }
  }
  return result
}

export function goldenCross(closes) {
  const sma20 = calcSMASeries(closes, 20)
  const sma50 = calcSMASeries(closes, 50)
  const last = closes.length - 1
  if (!sma20[last] || !sma50[last] || !sma20[last - 1] || !sma50[last - 1]) return false
  return sma20[last] > sma50[last] && sma20[last - 1] <= sma50[last - 1]
}
