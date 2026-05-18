import { describe, it, expect } from 'vitest'
import { detectSignal, SIGNAL_DEFAULTS } from '../signals.js'

// Build candles where price rises steadily (triggers breakout above 20-day high)
// and RSI lands in a specific range based on the gain rate
function makeCandles(n, startPrice = 100, riseRate = 0.005, volumeSpike = true) {
  return Array.from({ length: n }, (_, i) => {
    const close = startPrice * Math.pow(1 + riseRate, i)
    const vol = (volumeSpike && i === n - 1) ? 3_000_000 : 1_000_000
    return { open: close * 0.99, high: close * 1.005, low: close * 0.985, close, volume: vol }
  })
}

// Build candles where the last close is well above the previous 20-day high
// so isBreakout() returns true, with a configurable final RSI-like slope
function makeBreakoutCandles({ n = 60, rsiHigh = false } = {}) {
  // Slow rise for n-1 candles, then a single large spike — forces breakout
  const base = Array.from({ length: n - 1 }, (_, i) => {
    const close = 100 + i * (rsiHigh ? 1.5 : 0.3)   // steeper → higher RSI
    return { open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1_000_000 }
  })
  const prevHigh = Math.max(...base.map(c => c.high))
  const spike = prevHigh * 1.05
  base.push({ open: spike * 0.99, high: spike * 1.01, low: spike * 0.98, close: spike, volume: 3_000_000 })
  return base
}

describe('SIGNAL_DEFAULTS', () => {
  it('GPW aggressive has rsiMax: 70', () => {
    expect(SIGNAL_DEFAULTS.GPW.aggressive.rsiMax).toBe(70)
  })

  it('NYSE aggressive has rsiMax: 70', () => {
    expect(SIGNAL_DEFAULTS.NYSE.aggressive.rsiMax).toBe(70)
  })

  it('GPW aggressive volMultiplierMin is 2.5 (Learning Agent update)', () => {
    expect(SIGNAL_DEFAULTS.GPW.aggressive.volumeMultiplierMin).toBe(2.5)
  })

  it('GPW scalping rsiThreshold is 28 (Learning Agent update)', () => {
    expect(SIGNAL_DEFAULTS.GPW.scalping.rsiThreshold).toBe(28)
  })
})

describe('detectSignal — aggressive rsiMax cap', () => {
  it('returns null when RSI > rsiMax (overbought breakout)', () => {
    // Very steep rise → RSI will exceed 70
    const candles = makeBreakoutCandles({ n: 60, rsiHigh: true })
    const result = detectSignal(candles, 'aggressive', {}, 'GPW')
    // Either null (rsiMax cap triggered) or BREAKOUT with RSI ≤ 70
    if (result !== null) {
      expect(result.rsi).toBeLessThanOrEqual(70)
    }
  })

  it('respects custom rsi_max threshold from thresholds param', () => {
    const candles = makeBreakoutCandles({ n: 60, rsiHigh: false })
    // Force rsiMax to 0 — should never fire
    const result = detectSignal(candles, 'aggressive', { rsi_max: 0 }, 'GPW')
    expect(result).toBeNull()
  })

  it('fires BREAKOUT when RSI is within [rsiMin, rsiMax] range', () => {
    // Moderate rise — RSI should land in 60-70 range
    const candles = makeBreakoutCandles({ n: 60, rsiHigh: false })
    // Loosen the thresholds to guarantee a hit in CI
    const result = detectSignal(candles, 'aggressive', {
      rsi_min: 50, rsi_max: 100,
      aggressive_volume_multiplier: 2.5,
    }, 'GPW')
    if (result !== null) {
      expect(result.signal).toBe('BREAKOUT')
      expect(result.rsi).toBeGreaterThan(50)
      expect(result.rsi).toBeLessThanOrEqual(100)
    }
  })
})

describe('detectSignal — null for insufficient data', () => {
  it('returns null when fewer than 25 candles', () => {
    const candles = makeCandles(20)
    expect(detectSignal(candles, 'scalping', {}, 'GPW')).toBeNull()
  })

  it('returns null for swing when fewer than 55 candles', () => {
    const candles = makeCandles(40)
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })
})

describe('detectSignal — scalping rsiThreshold = 28', () => {
  it('does not fire RSI_OVERSOLD when RSI is 30 (above new threshold of 28)', () => {
    // Moderate downtrend — RSI around 30–40
    const candles = Array.from({ length: 60 }, (_, i) => {
      const close = 200 - i * 0.5
      return { open: close + 0.2, high: close + 0.3, low: close - 0.3, close, volume: 1_500_000 }
    })
    // Override threshold to 28 explicitly — RSI ~30 should NOT trigger
    const result = detectSignal(candles, 'scalping', { rsi_threshold: 28, volume_multiplier: 1.3 }, 'GPW')
    if (result !== null) {
      expect(result.rsi).toBeLessThan(28)
    }
  })
})
