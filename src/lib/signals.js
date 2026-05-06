import { calcRSI } from '../indicators/rsi.js'
import { calcSMA, calcSMASeries, goldenCross } from '../indicators/sma.js'
import { volumeMultiplier } from '../indicators/volume.js'
import { isBreakout } from '../indicators/breakout.js'

// Thresholds calibrated per exchange — May 2026
// NYSE: lower volume multipliers because mega-caps have less relative volume volatility
export const SIGNAL_DEFAULTS = {
  GPW: {
    scalping:   { rsiThreshold: 35, volumeMultiplierMin: 1.5 },
    swing:      { volumeMultiplierMin: 1.2, crossoverWindowDays: 3 },
    aggressive: { rsiMin: 60, volumeMultiplierMin: 2.0 },
  },
  NYSE: {
    scalping:   { rsiThreshold: 35, volumeMultiplierMin: 1.15 },
    swing:      { volumeMultiplierMin: 1.3, crossoverWindowDays: 3 },
    aggressive: { rsiMin: 60, volumeMultiplierMin: 1.5 },
  },
}

export function detectSignal(candles, strategy, thresholds = {}, exchange = 'GPW') {
  if (!candles || candles.length < 25) return null
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const price   = closes[closes.length - 1]
  const volMult = volumeMultiplier(volumes)

  const defaults = SIGNAL_DEFAULTS[exchange] ?? SIGNAL_DEFAULTS.GPW

  if (strategy === 'scalping') {
    const rsiThr = thresholds.rsi_threshold ?? defaults.scalping.rsiThreshold
    const volThr = thresholds.volume_multiplier ?? defaults.scalping.volumeMultiplierMin
    const rsi = calcRSI(closes)
    if (rsi !== null && rsi < rsiThr && volMult && volMult >= volThr) {
      return { signal: 'RSI_OVERSOLD', price, rsi, volMult,
        sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50) }
    }
  }

  if (strategy === 'swing') {
    if (candles.length < 55) return null
    const volThr = thresholds.swing_volume_multiplier ?? defaults.swing.volumeMultiplierMin
    const window = defaults.swing.crossoverWindowDays
    let crossed = false
    for (let i = 1; i <= Math.min(window, closes.length - 2); i++) {
      const dayClose  = closes[closes.length - i]
      const daySMA50  = calcSMA(closes.slice(0, closes.length - i + 1), 50)
      const prevClose = closes[closes.length - i - 1]
      const prevSMA50 = closes.length >= 51
        ? closes.slice(closes.length - i - 50, closes.length - i).reduce((a, b) => a + b, 0) / 50
        : null
      if (prevSMA50 && prevClose <= prevSMA50 && daySMA50 && dayClose > daySMA50) {
        crossed = true; break
      }
    }
    if (!crossed) crossed = goldenCross(closes)
    if (crossed && volMult && volMult >= volThr) {
      const rsi  = calcRSI(closes)
      const sma50s = calcSMASeries(closes, 50)
      return { signal: 'SMA50_CROSSOVER', price, rsi, volMult,
        sma20: calcSMA(closes, 20), sma50: sma50s[sma50s.length - 1] }
    }
  }

  if (strategy === 'aggressive') {
    const rsiMin = thresholds.rsi_min ?? defaults.aggressive.rsiMin
    const volThr = thresholds.aggressive_volume_multiplier ?? defaults.aggressive.volumeMultiplierMin
    const rsi = calcRSI(closes)
    if (isBreakout(candles) && rsi && rsi > rsiMin && volMult && volMult >= volThr) {
      return { signal: 'BREAKOUT', price, rsi, volMult,
        sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50) }
    }
  }

  return null
}

export function calcIndicators(candles, strategy, thresholds = {}, exchange = 'GPW') {
  if (!candles || candles.length < 25) return null
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const sig = detectSignal(candles, strategy, thresholds, exchange)
  return {
    rsi:      calcRSI(closes),
    sma20:    calcSMA(closes, 20),
    sma50:    calcSMA(closes, 50),
    volMult:  volumeMultiplier(volumes),
    price:    closes[closes.length - 1],
    signal:   sig?.signal ?? null,
    hasSignal: sig !== null,
  }
}
