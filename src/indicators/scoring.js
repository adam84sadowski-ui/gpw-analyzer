// Max raw score = 130 pts → normalized to 100
// RSI(25) + Vol(20) + SMA150(15) + Index(10) + Support(5) + Divergence(5)
// + MACD(±15) + Bollinger(±20) + Seasonality(±10) + HistEff(5, always 0)
const MAX_RAW = 130

export function calcScore(strategy, inputs) {
  const {
    rsi, volMult, sma150trend, nearSupport, divergence, indexTrend,
    macdScore = 0, bollingerScore = 0, seasonalityScore = 0,
  } = inputs
  let raw = 0

  // RSI (25 pts)
  if (strategy === 'scalping') {
    if (rsi != null) {
      if (rsi < 30)      raw += 25
      else if (rsi < 35) raw += 15
      else               raw += 5
    }
  } else if (strategy === 'aggressive') {
    if (rsi != null) {
      if (rsi >= 60 && rsi < 65)      raw += 25
      else if (rsi >= 65 && rsi < 75) raw += 20
      else if (rsi >= 75)             raw += 5
    }
  }
  // swing: RSI not primary driver

  // Volume (20 pts)
  if (volMult != null) {
    if (strategy === 'swing') {
      if (volMult >= 2.0)      raw += 20
      else if (volMult >= 1.5) raw += 15
      else if (volMult >= 1.3) raw += 10
      else                     raw += 5
    } else if (strategy === 'aggressive') {
      if (volMult >= 3.0)      raw += 20
      else if (volMult >= 2.5) raw += 15
      else if (volMult >= 2.0) raw += 10
    } else {
      if (volMult >= 3.0)      raw += 20
      else if (volMult >= 2.0) raw += 15
      else if (volMult >= 1.5) raw += 10
      else if (volMult >= 1.2) raw += 5
    }
  }

  // SMA150 trend (15 pts)
  if (sma150trend === 'above') raw += 15

  // Index correlation (10 pts)
  if (indexTrend === 'up')      raw += 10
  else if (indexTrend === 'neutral') raw += 3

  // Support proximity (5 pts)
  if (strategy !== 'aggressive' && nearSupport != null) raw += 5

  // RSI divergence (5 pts)
  if (divergence === 'bullish') raw += 5

  // MACD (±15 pts)
  raw += Math.max(-15, Math.min(15, macdScore))

  // Bollinger (±20 pts)
  raw += Math.max(-20, Math.min(20, bollingerScore))

  // Seasonality (±10 pts)
  raw += Math.max(-10, Math.min(10, seasonalityScore))

  // Historical effectiveness — 5 pts, always 0 until KV data populated
  // raw += histEffScore ?? 0

  return Math.min(100, Math.max(0, Math.round(raw / MAX_RAW * 100)))
}
