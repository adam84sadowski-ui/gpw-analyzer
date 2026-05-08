import { calcRSI } from '../indicators/rsi.js'
import { calcSMA, calcSMASeries, goldenCross } from '../indicators/sma.js'
import { volumeMultiplier } from '../indicators/volume.js'
import { isBreakout } from '../indicators/breakout.js'
import { detectRSIDivergence } from '../indicators/divergence.js'
import { calcATR } from '../indicators/atr.js'
import { detectSupportProximity } from '../indicators/support.js'
import { calculateMACD, getMACDSignal } from '../indicators/macd.js'
import { calculateBollinger, getBollingerSignal } from '../indicators/bollinger.js'
import { getSeasonalityScore } from '../indicators/seasonality.js'
import { calcScore } from '../indicators/scoring.js'

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

const ATR_STOP_CONFIG = {
  scalping:   { multiplier: 1.0, min: 1.5, max: 5.0 },
  swing:      { multiplier: 1.5, min: 3.0, max: 8.0 },
  aggressive: { multiplier: 2.0, min: 5.0, max: 15.0 },
}

function calcDynamicStopLoss(atr, price, strategy) {
  const cfg = ATR_STOP_CONFIG[strategy]
  if (!cfg || !atr || !price) return null
  const rawPct = (atr * cfg.multiplier / price) * 100
  return Math.round(Math.min(cfg.max, Math.max(cfg.min, rawPct)) * 10) / 10
}

export function detectSignal(candles, strategy, thresholds = {}, exchange = 'GPW', indexTrend = 'neutral', monthlyReturns = null) {
  if (!candles || candles.length < 25) return null
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const price   = closes[closes.length - 1]
  const volMult = volumeMultiplier(volumes)

  const defaults    = SIGNAL_DEFAULTS[exchange] ?? SIGNAL_DEFAULTS.GPW
  const divergence  = detectRSIDivergence(closes)
  const atr         = calcATR(candles)
  const atrPct      = atr != null ? Math.round(atr / price * 10000) / 100 : null
  const sma150      = calcSMA(closes, 150)
  const sma150trend = sma150 != null ? (price > sma150 ? 'above' : 'below') : null
  const nearSupport = detectSupportProximity(candles, price)

  const macd        = calculateMACD(closes)
  const macdSig     = getMACDSignal(macd)
  const bands       = calculateBollinger(closes)
  const bollSig     = getBollingerSignal(price, bands, strategy)
  const currentMonth = new Date().getMonth()
  const seasSig     = getSeasonalityScore(monthlyReturns, currentMonth)

  const scoreInputs = {
    volMult, sma150trend, nearSupport, divergence, indexTrend,
    macdScore: macdSig.score, bollingerScore: bollSig.score, seasonalityScore: seasSig.score,
  }

  const extra = {
    atr, atrPct, nearSupport, sma150trend, sma150, indexTrend,
    macd: { line: macdSig.macdLine, signal: macdSig.signalLine, histogram: macdSig.histogram, trend: macdSig.trend, score: macdSig.score },
    bollinger: { ...bands, status: bollSig.status, score: bollSig.score },
    seasonality: { avgReturn: seasSig.avgReturn, score: seasSig.score, month: currentMonth },
    divergence,
  }

  if (strategy === 'scalping') {
    if (sma150 != null && price <= sma150) return null
    const rsiThr = thresholds.rsi_threshold ?? defaults.scalping.rsiThreshold
    const volThr = thresholds.volume_multiplier ?? defaults.scalping.volumeMultiplierMin
    const rsi = calcRSI(closes)
    if (rsi !== null && rsi < rsiThr && volMult && volMult >= volThr) {
      const score = calcScore('scalping', { ...scoreInputs, rsi })
      return { signal: 'RSI_OVERSOLD', price, rsi, volMult,
        sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50),
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'scalping'),
        score, ...extra }
    }
  }

  if (strategy === 'swing') {
    if (sma150 != null && price <= sma150) return null
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
      if (prevSMA50 && prevClose <= prevSMA50 && daySMA50 && dayClose > daySMA50) { crossed = true; break }
    }
    if (!crossed) crossed = goldenCross(closes)
    if (crossed && volMult && volMult >= volThr) {
      const rsi    = calcRSI(closes)
      const sma50s = calcSMASeries(closes, 50)
      const score  = calcScore('swing', { ...scoreInputs, rsi })
      return { signal: 'SMA50_CROSSOVER', price, rsi, volMult,
        sma20: calcSMA(closes, 20), sma50: sma50s[sma50s.length - 1],
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'swing'),
        score, ...extra }
    }
  }

  if (strategy === 'aggressive') {
    const rsiMin = thresholds.rsi_min ?? defaults.aggressive.rsiMin
    const volThr = thresholds.aggressive_volume_multiplier ?? defaults.aggressive.volumeMultiplierMin
    const rsi = calcRSI(closes)
    if (isBreakout(candles) && rsi && rsi > rsiMin && volMult && volMult >= volThr) {
      const sma150Warning = sma150 != null && price <= sma150
      const score = calcScore('aggressive', { ...scoreInputs, rsi })
      return { signal: 'BREAKOUT', price, rsi, volMult,
        sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50),
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'aggressive'),
        sma150Warning, score, ...extra }
    }
  }

  return null
}

export function calcIndicators(candles, strategy, thresholds = {}, exchange = 'GPW', indexTrend = 'neutral', monthlyReturns = null) {
  if (!candles || candles.length < 25) return null
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const price   = closes[closes.length - 1]
  const sig     = detectSignal(candles, strategy, thresholds, exchange, indexTrend, monthlyReturns)
  const sma150  = calcSMA(closes, 150)
  const atr     = calcATR(candles)
  const bands   = calculateBollinger(closes)
  const macd    = calculateMACD(closes)
  const macdSig = getMACDSignal(macd)
  return {
    rsi:             calcRSI(closes),
    sma20:           calcSMA(closes, 20),
    sma50:           calcSMA(closes, 50),
    sma150,
    sma150trend:     sma150 != null ? (price > sma150 ? 'above' : 'below') : null,
    volMult:         volumeMultiplier(volumes),
    price,
    atr,
    atrPct:          atr != null ? Math.round(atr / price * 10000) / 100 : null,
    nearSupport:     detectSupportProximity(candles, price),
    bollinger:       bands ? { ...bands, status: getBollingerSignal(price, bands, strategy).status } : null,
    macd:            { line: macdSig.macdLine, signal: macdSig.signalLine, histogram: macdSig.histogram, trend: macdSig.trend },
    signal:          sig?.signal ?? null,
    hasSignal:       sig !== null,
    score:           sig?.score ?? null,
    dynamicStopLoss: sig?.dynamicStopLoss ?? null,
    sma150Warning:   sig?.sma150Warning ?? false,
    divergence:      detectRSIDivergence(closes),
    indexTrend,
  }
}
