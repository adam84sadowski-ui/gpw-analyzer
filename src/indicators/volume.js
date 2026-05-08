export function avgVolume(volumes, period = 20) {
  if (volumes.length < period + 1) return null
  const slice = volumes.slice(-period - 1, -1)  // exclude today's partial candle
  return slice.reduce((a, b) => a + b, 0) / period
}

export function volumeMultiplier(volumes, period = 20) {
  const avg = avgVolume(volumes, period)
  if (!avg) return null
  const current = volumes[volumes.length - 1]
  return Math.round((current / avg) * 100) / 100
}
