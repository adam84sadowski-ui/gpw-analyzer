function findSwingPoints(candles, lookback = 5, window = 100) {
  const slice = candles.slice(-window - lookback)
  const supports    = []
  const resistances = []
  for (let i = lookback; i < slice.length - lookback; i++) {
    const c = slice[i]
    let isLow = true, isHigh = true
    for (let j = 1; j <= lookback; j++) {
      if (slice[i - j].low  <= c.low)  isLow  = false
      if (slice[i + j].low  <= c.low)  isLow  = false
      if (slice[i - j].high >= c.high) isHigh = false
      if (slice[i + j].high >= c.high) isHigh = false
    }
    if (isLow)  supports.push(c.low)
    if (isHigh) resistances.push(c.high)
  }
  return { supports: clusterLevels(supports), resistances: clusterLevels(resistances) }
}

function clusterLevels(levels, tolerance = 0.02) {
  const sorted = [...levels].sort((a, b) => a - b)
  const clusters = []
  for (const level of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(level - last.avg) / last.avg < tolerance) {
      last.sum += level
      last.count++
      last.avg = last.sum / last.count
    } else {
      clusters.push({ avg: level, sum: level, count: 1 })
    }
  }
  return clusters.map(c => Math.round(c.avg * 100) / 100)
}

export function detectSupportProximity(candles, price, tolerance = 0.03) {
  if (candles.length < 30) return null
  const { supports } = findSwingPoints(candles)
  for (const level of supports.slice().reverse()) {
    if (price >= level * (1 - tolerance) && price <= level * (1 + tolerance * 0.5)) {
      return level
    }
  }
  return null
}

export function detectResistanceProximity(candles, price, tolerance = 0.03) {
  if (candles.length < 30) return null
  const { resistances } = findSwingPoints(candles)
  for (const level of resistances) {
    if (Math.abs(price - level) / level < tolerance) return level
  }
  return null
}
