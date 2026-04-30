export function isBreakout(candles, period = 20) {
  if (candles.length < period + 1) return false
  const recent = candles.slice(-period - 1, -1)
  const maxHigh = Math.max(...recent.map(c => c.high))
  const last = candles[candles.length - 1]
  return last.close > maxHigh
}

export function nearATH(candles, period = 252, threshold = 0.05) {
  if (candles.length < 2) return false
  const closes = candles.slice(-period).map(c => c.close)
  const ath = Math.max(...closes)
  const last = closes[closes.length - 1]
  return (ath - last) / ath <= threshold
}
