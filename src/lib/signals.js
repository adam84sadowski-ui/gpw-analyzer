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
    scalping:   { rsiThresholdMin: 34, rsiThreshold: 46, volumeMultiplierMin: 1.2, rsiPeriod: 9 },
    swing:      { rsiMin: 36, rsiMax: 55, volumeMultiplierMin: 1.1, sma50DeltaMin: -3, sma50DeltaMax: 5, rsiPeriod: 14 },
    aggressive: { rsiMin: 60, rsiMax: 70, volumeMultiplierMin: 2.5, rsiPeriod: 14 },
  },
  NYSE: {
    scalping:   { rsiThresholdMin: 35, rsiThreshold: 50, volumeMultiplierMin: 1.1, rsiPeriod: 9 },
    swing:      { rsiMin: 40, rsiMax: 58, volumeMultiplierMin: 1.1, sma50DeltaMin: -2, sma50DeltaMax: 5, rsiPeriod: 14 },
    aggressive: { rsiMin: 60, rsiMax: 75, volumeMultiplierMin: 2.0, rsiPeriod: 14 },
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

export function detectSignal(candles, strategy, thresholds = {}, exchange = 'GPW', indexTrend = 'neutral', monthlyReturns = null, indexReturn20d = null) {
  if (!candles || candles.length < 25) return null
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const price   = closes[closes.length - 1]
  const volMult = volumeMultiplier(volumes)
  const stock20dReturn = closes.length >= 21
    ? (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]
    : null
  const rsRatio = stock20dReturn != null && indexReturn20d != null
    ? ((1 + stock20dReturn) / (1 + indexReturn20d)) - 1
    : null
  const rsScore = rsRatio == null ? 0
    : rsRatio > 0.20 ? 10
    : rsRatio > 0.10 ? 7
    : rsRatio > 0.03 ? 3
    : rsRatio < -0.10 ? -10
    : rsRatio < -0.03 ? -7
    : 0

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
    rsScore,
  }

  const extra = {
    atr, atrPct, nearSupport, sma150trend, sma150, indexTrend,
    macd: { line: macdSig.macdLine, signal: macdSig.signalLine, histogram: macdSig.histogram, trend: macdSig.trend, score: macdSig.score },
    bollinger: { ...bands, status: bollSig.status, score: bollSig.score },
    seasonality: { avgReturn: seasSig.avgReturn, score: seasSig.score, month: currentMonth },
    divergence,
    rs: { ratio: rsRatio, score: rsScore, stock20d: stock20dReturn },
  }

  if (strategy === 'scalping') {
    if (sma150 != null && price <= sma150) return null
    const rsiMin    = thresholds.rsi_threshold_min ?? defaults.scalping.rsiThresholdMin
    const rsiMax    = thresholds.rsi_threshold     ?? defaults.scalping.rsiThreshold
    const volThr    = thresholds.volume_multiplier ?? defaults.scalping.volumeMultiplierMin
    const rsiPeriod = thresholds.rsiPeriod ?? defaults.scalping.rsiPeriod ?? 14
    const rsi    = calcRSI(closes, rsiPeriod)
    const sma20  = calcSMA(closes, 20)
    const sma50  = calcSMA(closes, 50)
    // Pullback-in-trend: RSI in reset zone, price above SMA50, within -5%/+3% of SMA20
    const aboveSma50 = sma50 != null && price > sma50
    const nearSma20  = sma20 != null && price >= sma20 * 0.95 && price <= sma20 * 1.03
    if (rsi !== null && rsi >= rsiMin && rsi <= rsiMax && aboveSma50 && nearSma20 && volMult && volMult >= volThr) {
      const signalName = rsi <= 37 ? 'RSI_OVERSOLD' : 'PULLBACK_UPTREND'
      const score = calcScore('scalping', { ...scoreInputs, rsi })
      return { signal: signalName, price, rsi, rsiPeriod, volMult,
        sma20, sma50,
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'scalping'),
        score, ...extra }
    }

    // BB_BOUNCE — price at/below lower Bollinger Band, no RSI requirement
    if (bands?.lower != null && price <= bands.lower * 1.01 && sma150trend === 'above' && volMult != null && volMult >= 1.3) {
      const rsiForBB = calcRSI(closes, 14)
      const score = calcScore('scalping', { ...scoreInputs, rsi: rsiForBB ?? 50 })
      return { signal: 'BB_BOUNCE', price, rsi: rsiForBB, rsiPeriod: 14, volMult,
        sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50),
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'scalping'),
        score, ...extra }
    }

    // VOLUME_CLIMAX_REVERSAL — extreme volume + hammer candle on the same (yesterday's) session
    // volMult uses candles[-2] (yesterday), so we check hammer on candles[-2] as well
    if (candles.length >= 3 && volMult != null && volMult >= 3.0 && sma150trend === 'above') {
      const yesterday = candles[candles.length - 2]
      const range = yesterday.high - yesterday.low
      if (range > 0) {
        const closeVsRange = (yesterday.close - yesterday.low) / range
        const body = Math.abs(yesterday.close - yesterday.open)
        const lowerShadow = Math.min(yesterday.close, yesterday.open) - yesterday.low
        const isHammer = closeVsRange >= 0.65 && (body === 0 || lowerShadow >= body * 1.5)
        if (isHammer) {
          const rsiVcr = calcRSI(closes, 14)
          const score = calcScore('scalping', { ...scoreInputs, rsi: rsiVcr ?? 50 })
          return { signal: 'VOLUME_CLIMAX_REVERSAL', price, rsi: rsiVcr, rsiPeriod: 14, volMult,
            sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50),
            dynamicStopLoss: calcDynamicStopLoss(atr, price, 'scalping'),
            closeVsRange: Math.round(closeVsRange * 100) / 100,
            score, ...extra }
        }
      }
    }

    // VOL_SURGE — momentum/catalyst signal, NYSE only
    // 7 safety filters: volMult ≥ 2.5x, price +3-8%, RSI 50-70,
    //   closeVsHigh ≥ 90% (buyers held), sma150 above, indexTrend ≠ down, MACD bullish
    if (exchange === 'NYSE' && candles.length >= 2) {
      const last = candles[candles.length - 1]
      const prev = candles[candles.length - 2]
      if (last && prev && last.high > 0 && prev.close > 0) {
        const priceChange  = (last.close - prev.close) / prev.close * 100
        const closeVsHigh  = last.close / last.high
        const rsi14        = calcRSI(closes, 14)
        if (
          volMult           >= 2.5            &&
          priceChange        >= 3              &&
          priceChange        <= 8              &&
          rsi14             != null            &&
          rsi14              >= 50             &&
          rsi14              <= 70             &&
          closeVsHigh        >= 0.90           &&
          sma150trend        === 'above'       &&
          indexTrend         !== 'down'        &&
          macdSig.trend      === 'bullish'
        ) {
          const score = calcScore('scalping', { ...scoreInputs, rsi: rsi14 })
          return { signal: 'VOL_SURGE', price, rsi: rsi14, rsiPeriod: 14, volMult,
            priceChange: Math.round(priceChange * 10) / 10,
            closeVsHigh: Math.round(closeVsHigh * 1000) / 1000,
            sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50),
            dynamicStopLoss: null,
            score, ...extra }
        }
      }
    }
  }

  if (strategy === 'swing') {
    if (sma150 != null && price <= sma150) return null
    if (candles.length < 55) return null
    const rsiFloor  = defaults.swing.rsiMin
    const rsiCeil   = defaults.swing.rsiMax
    const volThr    = thresholds.swing_volume_multiplier ?? defaults.swing.volumeMultiplierMin
    const dMin      = defaults.swing.sma50DeltaMin
    const dMax      = defaults.swing.sma50DeltaMax
    const rsiPeriod = thresholds.rsiPeriod ?? defaults.swing.rsiPeriod ?? 14
    const rsi    = calcRSI(closes, rsiPeriod)
    const sma50s = calcSMASeries(closes, 50)
    const sma50  = sma50s[sma50s.length - 1]
    const sma50Delta = sma50 != null ? Math.round((price - sma50) / sma50 * 1000) / 10 : null

    // NYSE: reject bearish MACD
    if (exchange === 'NYSE' && macdSig.trend !== 'bullish') return null

    const sma20 = calcSMA(closes, 20)

    // Pullback-to-SMA50: price within proximity band, RSI in reset zone, mild volume
    const inPullbackZone = sma50Delta != null && sma50Delta >= dMin && sma50Delta <= dMax
    const rsiReset       = rsi != null && rsi >= rsiFloor && rsi <= rsiCeil
    if (inPullbackZone && rsiReset && volMult && volMult >= volThr) {
      const score = calcScore('swing', { ...scoreInputs, rsi })
      return { signal: 'PULLBACK_TO_SMA50', price, rsi, rsiPeriod, volMult,
        sma20, sma50,
        sma50Delta,
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'swing'),
        score, ...extra }
    }

    // PULLBACK_TO_SMA20 — earlier entry in strong uptrends (SMA20 > SMA50 > SMA150)
    const sma20Delta = sma20 != null ? Math.round((price - sma20) / sma20 * 1000) / 10 : null
    const strongAlignment = sma20 != null && sma50 != null && sma150 != null && sma20 > sma50 && sma50 > sma150
    const nearSma20Swing = sma20Delta != null && sma20Delta >= -3 && sma20Delta <= 2
    const rsiSma20Valid = rsi != null && rsi >= 42 && rsi <= 60
    if (strongAlignment && nearSma20Swing && rsiSma20Valid && volMult != null && volMult >= volThr) {
      const score = calcScore('swing', { ...scoreInputs, rsi })
      return { signal: 'PULLBACK_TO_SMA20', price, rsi, rsiPeriod, volMult,
        sma20, sma50,
        sma50Delta: sma20Delta,
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'swing'),
        score, ...extra }
    }
  }

  if (strategy === 'aggressive') {
    const rsiMin    = thresholds.rsi_min ?? defaults.aggressive.rsiMin
    const rsiMax    = thresholds.rsi_max ?? defaults.aggressive.rsiMax
    const volThr    = thresholds.aggressive_volume_multiplier ?? defaults.aggressive.volumeMultiplierMin
    const rsiPeriod = thresholds.rsiPeriod ?? defaults.aggressive.rsiPeriod ?? 14
    const rsi = calcRSI(closes, rsiPeriod)
    // NYSE: block dead-cat bounces (sma150) and shooting stars (closeVsHigh)
    if (exchange === 'NYSE' && sma150 != null && price <= sma150) return null
    if (exchange === 'NYSE' && candles.length >= 1) {
      const last = candles[candles.length - 1]
      if (last.high > 0 && last.close / last.high < 0.85) return null
    }
    if (isBreakout(candles) && rsi && rsi > rsiMin && rsi <= rsiMax && volMult && volMult >= volThr) {
      const sma150Warning = sma150 != null && price <= sma150
      const score = calcScore('aggressive', { ...scoreInputs, rsi })
      return { signal: 'BREAKOUT', price, rsi, rsiPeriod, volMult,
        sma20: calcSMA(closes, 20), sma50: calcSMA(closes, 50),
        dynamicStopLoss: calcDynamicStopLoss(atr, price, 'aggressive'),
        sma150Warning, score, ...extra }
    }
  }

  return null
}

export function calcIndicators(candles, strategy, thresholds = {}, exchange = 'GPW', indexTrend = 'neutral', monthlyReturns = null, indexReturn20d = null) {
  if (!candles || candles.length < 25) return null
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const price   = closes[closes.length - 1]
  const sig     = detectSignal(candles, strategy, thresholds, exchange, indexTrend, monthlyReturns, indexReturn20d)
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
    macdScore:       macdSig.score ?? 0,
    bollingerScore:  bands ? (getBollingerSignal(price, bands, strategy).score ?? 0) : 0,
    signal:          sig?.signal ?? null,
    hasSignal:       sig !== null,
    score:           sig?.score ?? calcScore(strategy, {
      rsi:              calcRSI(closes),
      volMult:          volumeMultiplier(volumes),
      sma150trend:      sma150 != null ? (price > sma150 ? 'above' : 'below') : null,
      nearSupport:      detectSupportProximity(candles, price),
      divergence:       detectRSIDivergence(closes),
      indexTrend,
      macdScore:        macdSig.score ?? 0,
      bollingerScore:   bands ? (getBollingerSignal(price, bands, strategy).score ?? 0) : 0,
      seasonalityScore: getSeasonalityScore(monthlyReturns, new Date().getMonth()).score ?? 0,
      rsScore:          sig?.rs?.score ?? 0,
    }),
    dynamicStopLoss: sig?.dynamicStopLoss ?? null,
    sma150Warning:   sig?.sma150Warning ?? false,
    divergence:      detectRSIDivergence(closes),
    indexTrend,
    rs:              sig?.rs ?? null,
  }
}
