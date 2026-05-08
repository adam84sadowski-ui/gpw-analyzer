export function calculateBollinger(prices, period = 20, stdDevMult = 2) {
  if (prices.length < period) return null
  const slice   = prices.slice(-period)
  const middle  = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((s, p) => s + Math.pow(p - middle, 2), 0) / period
  const stdDev  = Math.sqrt(variance)
  const upper   = Math.round((middle + stdDevMult * stdDev) * 100) / 100
  const lower   = Math.round((middle - stdDevMult * stdDev) * 100) / 100
  const bandwidth = stdDev > 0 ? Math.round((upper - lower) / middle * 10000) / 100 : 0
  return { upper, middle: Math.round(middle * 100) / 100, lower, bandwidth }
}

export function getBollingerSignal(price, bands, strategy = 'scalping') {
  if (!bands) return { score: 0, status: null }
  const { upper, lower, bandwidth } = bands
  let score  = 0
  let status = null

  if (price < lower) {
    score  += 20
    status  = 'below_lower'
  } else if (price > upper) {
    if (strategy === 'aggressive') score += 10
    else score -= 10
    status = 'above_upper'
  }

  if (bandwidth < 5 && status === null) {
    status = 'consolidation'
  }

  return { score, status, bandwidth }
}
