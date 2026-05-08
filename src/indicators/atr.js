export function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i]
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low  - prev.close),
    )
  })
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
  }
  return Math.round(atr * 100) / 100
}
