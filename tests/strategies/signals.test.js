import { describe, it, expect } from 'vitest'
import { detectSignal } from '../../src/lib/signals.js'

// Builds a gradual uptrend followed by an optional pullback.
// dailyGain and pullbackRate are price multipliers applied each day.
function makeUptrendCandles({
  total       = 160,
  dailyGain   = 1.004,
  pullbackDays = 0,
  pullbackRate = 0.985,
  volBase     = 100000,
  volSpike    = 1.3,
} = {}) {
  let price = 100
  const uptrendDays = total - pullbackDays
  const candles = []

  for (let i = 0; i < uptrendDays; i++) {
    price *= dailyGain
    candles.push({ open: price * 0.999, high: price * 1.003, low: price * 0.998, close: price, volume: volBase })
  }

  for (let i = 0; i < pullbackDays; i++) {
    price *= pullbackRate
    candles.push({ open: price / pullbackRate, high: price / pullbackRate * 1.001, low: price * 0.999, close: price, volume: volBase * volSpike })
  }

  return candles
}

function makeDowntrendCandles(n = 200) {
  let price = 200
  return Array.from({ length: n }, () => {
    price *= 0.997
    return { open: price / 0.997, high: price / 0.997, low: price * 0.998, close: price, volume: 100000 }
  })
}

// ─── SCALPING — PULLBACK_IN_TREND ─────────────────────────────────────────

describe('detectSignal — scalping (PULLBACK_IN_TREND)', () => {
  it('returns null when fewer than 25 candles', () => {
    const candles = makeUptrendCandles({ total: 20 })
    expect(detectSignal(candles, 'scalping', {}, 'GPW')).toBeNull()
  })

  it('returns null when price is below SMA150 (downtrend)', () => {
    const candles = makeDowntrendCandles(200)
    expect(detectSignal(candles, 'scalping', {}, 'GPW')).toBeNull()
  })

  it('returns null when RSI is above upper bound (no pullback, pure uptrend)', () => {
    // RSI(9) stays near 70+ in a steady uptrend — above rsiThreshold=46
    const candles = makeUptrendCandles({ total: 180 })
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    // VOL_SURGE is NYSE-only; pure uptrend has volMult≈1.0, RSI too high for PULLBACK_IN_TREND
    expect(result).toBeNull()
  })

  it('returns null when volume is insufficient', () => {
    // Same pullback shape but volSpike=1.0 → volMult below 1.2 threshold
    const candles = makeUptrendCandles({ total: 160, pullbackDays: 3, pullbackRate: 0.985, volSpike: 1.0 })
    expect(detectSignal(candles, 'scalping', {}, 'GPW')).toBeNull()
  })

  it('returns RSI_OVERSOLD signal when pullback-in-trend conditions are met', () => {
    // 157 uptrend days + 3 pullback days → RSI(9) lands ~39, price stays above SMA50 and near SMA20
    const candles = makeUptrendCandles({ total: 160, pullbackDays: 3, pullbackRate: 0.985, volSpike: 1.3 })
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    expect(result).not.toBeNull()
    expect(result.signal).toBe('RSI_OVERSOLD')
    expect(result.rsi).toBeGreaterThanOrEqual(34)
    expect(result.rsi).toBeLessThanOrEqual(46)
    expect(result.rsi).toBeDefined()
    expect(result.price).toBeGreaterThan(0)
    expect(result.volMult).toBeGreaterThanOrEqual(1.2)
  })

  it('returns RSI_OVERSOLD signal for NYSE with wider RSI band', () => {
    const candles = makeUptrendCandles({ total: 160, pullbackDays: 3, pullbackRate: 0.985, volSpike: 1.2 })
    const result = detectSignal(candles, 'scalping', {}, 'NYSE')
    expect(result).not.toBeNull()
    expect(result.signal).toBe('RSI_OVERSOLD')
    expect(result.rsi).toBeGreaterThanOrEqual(35)
    expect(result.rsi).toBeLessThanOrEqual(50)
  })
})

// ─── SWING — PULLBACK_TO_SMA50 ────────────────────────────────────────────

describe('detectSignal — swing (PULLBACK_TO_SMA50)', () => {
  it('returns null when fewer than 55 candles', () => {
    const candles = makeUptrendCandles({ total: 50 })
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('returns null when price is below SMA150 (downtrend)', () => {
    const candles = makeDowntrendCandles(200)
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('returns null when RSI is above rsiMax (overbought, no pullback)', () => {
    // Pure uptrend → RSI(14) stays above 55 (GPW rsiMax)
    const candles = makeUptrendCandles({ total: 180 })
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('returns null when price is too far above SMA50 (no pullback to SMA50)', () => {
    // 160-day uptrend with no pullback → sma50Delta typically > 5%
    const candles = makeUptrendCandles({ total: 160 })
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('returns null when volume is insufficient', () => {
    const candles = makeUptrendCandles({ total: 206, pullbackDays: 6, pullbackRate: 0.990, volSpike: 1.0 })
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('returns PULLBACK_TO_SMA50 signal when conditions are met', () => {
    // 200 uptrend + 6 pullback days → price pulls back near SMA50, RSI(14) ~42, mild volume spike
    const candles = makeUptrendCandles({ total: 206, pullbackDays: 6, pullbackRate: 0.990, volSpike: 1.25 })
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    expect(result).not.toBeNull()
    expect(result.signal).toBe('PULLBACK_TO_SMA50')
    expect(result.sma50Delta).toBeGreaterThanOrEqual(-3)
    expect(result.sma50Delta).toBeLessThanOrEqual(5)
    expect(result.rsi).toBeGreaterThanOrEqual(36)
    expect(result.rsi).toBeLessThanOrEqual(55)
    expect(result.volMult).toBeGreaterThanOrEqual(1.1)
  })
})
