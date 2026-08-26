export function avgVolume(volumes, period = 20) {
  if (volumes.length < period + 1) return null
  const slice = volumes.slice(-period - 1, -1)  // exclude today's partial candle
  return slice.reduce((a, b) => a + b, 0) / period
}

// Compares yesterday's final volume to the 20-day average of the days before it.
// Avoids using today's intraday candle, which is always a fraction of a full day.
export function volumeMultiplier(volumes, period = 20) {
  if (volumes.length < period + 2) return null
  const slice = volumes.slice(-period - 2, -2)  // 20 complete days before yesterday
  const avg = slice.reduce((a, b) => a + b, 0) / period
  if (!avg) return null
  const current = volumes[volumes.length - 2]  // yesterday's final volume
  return Math.round((current / avg) * 100) / 100
}
