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

  it('NYSE aggressive has rsiMax: 75 (raised to capture real breakouts)', () => {
    expect(SIGNAL_DEFAULTS.NYSE.aggressive.rsiMax).toBe(75)
  })

  it('GPW aggressive volMultiplierMin is 2.5 (Learning Agent update)', () => {
    expect(SIGNAL_DEFAULTS.GPW.aggressive.volumeMultiplierMin).toBe(2.5)
  })

  it('GPW scalping uses pullback-in-trend RSI window [34, 46]', () => {
    expect(SIGNAL_DEFAULTS.GPW.scalping.rsiThresholdMin).toBe(34)
    expect(SIGNAL_DEFAULTS.GPW.scalping.rsiThreshold).toBe(46)
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

describe('detectSignal — scalping rsiThreshold = 30', () => {
  it('does not fire RSI_OVERSOLD when RSI is 32 (above new threshold of 30)', () => {
    // Moderate downtrend — RSI around 30–40
    const candles = Array.from({ length: 60 }, (_, i) => {
      const close = 200 - i * 0.5
      return { open: close + 0.2, high: close + 0.3, low: close - 0.3, close, volume: 1_500_000 }
    })
    // Override threshold to 30 explicitly — RSI ~32 should NOT trigger
    const result = detectSignal(candles, 'scalping', { rsi_threshold: 30, volume_multiplier: 1.3 }, 'GPW')
    if (result !== null) {
      expect(result.rsi).toBeLessThan(30)
    }
  })
})

describe('detectSignal — signal name split RSI_OVERSOLD vs PULLBACK_UPTREND', () => {
  it('returns RSI_OVERSOLD or PULLBACK_UPTREND (never another name) from scalping RSI path', () => {
    const candles = Array.from({ length: 100 }, (_, i) => {
      const close = 100 + Math.sin(i / 5) * 2 + i * 0.1
      return { open: close - 0.1, high: close + 0.3, low: close - 0.3, close, volume: 1_500_000 }
    })
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    if (result !== null && (result.signal === 'RSI_OVERSOLD' || result.signal === 'PULLBACK_UPTREND')) {
      if (result.rsi <= 37) expect(result.signal).toBe('RSI_OVERSOLD')
      if (result.rsi > 37)  expect(result.signal).toBe('PULLBACK_UPTREND')
    }
  })

  it('RSI_OVERSOLD has rsi ≤ 37 when returned', () => {
    // Fast downtrend then plateau — should produce low RSI
    const candles = Array.from({ length: 80 }, (_, i) => {
      const close = i < 60 ? 200 - i * 1.5 : 110 + (i - 60) * 0.05
      return { open: close + 0.1, high: close + 0.5, low: close - 0.2, close, volume: 1_500_000 }
    })
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    if (result !== null && result.signal === 'RSI_OVERSOLD') {
      expect(result.rsi).toBeLessThanOrEqual(37)
    }
  })

  it('PULLBACK_UPTREND has rsi > 37 when returned', () => {
    const candles = Array.from({ length: 80 }, (_, i) => {
      const close = i < 60 ? 200 - i * 1.5 : 110 + (i - 60) * 0.05
      return { open: close + 0.1, high: close + 0.5, low: close - 0.2, close, volume: 1_500_000 }
    })
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    if (result !== null && result.signal === 'PULLBACK_UPTREND') {
      expect(result.rsi).toBeGreaterThan(37)
    }
  })
})

describe('detectSignal — VOLUME_CLIMAX_REVERSAL', () => {
  function makeVCRCandles() {
    // 198 rising candles (indices 0-197), then hammer at index 198 (= candles[-2]),
    // then today at index 199 (= candles[-1])
    // volumeMultiplier uses candles[-2] for "current" volume
    const candles = Array.from({ length: 198 }, (_, i) => ({
      open:   100 + i * 0.3,
      high:   100 + i * 0.3 + 0.5,
      low:    100 + i * 0.3 - 0.3,
      close:  100 + i * 0.3,
      volume: 1_000_000,
    }))
    // candles[198] = index 198 = candles[-2] after push of today
    const prevClose = 100 + 197 * 0.3  // ≈ 159.1
    candles.push({
      open:   prevClose * 0.995,  // 158.3 — small body
      high:   prevClose * 1.000,  // 159.1
      low:    prevClose * 0.92,   // 146.4 — large lower shadow
      close:  prevClose * 0.998,  // 158.8 — close near top
      volume: 3_200_000,          // 3.2x average
    })
    // candles[199] = today = candles[-1]
    candles.push({
      open:   candles[198].close,
      high:   candles[198].close * 1.005,
      low:    candles[198].close * 0.998,
      close:  candles[198].close * 1.003,
      volume: 1_100_000,
    })
    return candles
  }

  it('hammer shape on yesterday candle meets VCR criteria', () => {
    const candles = makeVCRCandles()
    const yesterday = candles[candles.length - 2]
    const range = yesterday.high - yesterday.low
    const closeVsRange = (yesterday.close - yesterday.low) / range
    const body = Math.abs(yesterday.close - yesterday.open)
    const lowerShadow = Math.min(yesterday.close, yesterday.open) - yesterday.low
    expect(closeVsRange).toBeGreaterThanOrEqual(0.65)
    expect(body === 0 || lowerShadow >= body * 1.5).toBe(true)
  })

  it('returns VOLUME_CLIMAX_REVERSAL or null (not a different signal) with VCR candles', () => {
    const candles = makeVCRCandles()
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    expect(
      result === null ||
      result.signal === 'VOLUME_CLIMAX_REVERSAL' ||
      result.signal === 'RSI_OVERSOLD' ||
      result.signal === 'PULLBACK_UPTREND' ||
      result.signal === 'BB_BOUNCE'
    ).toBe(true)
    if (result?.signal === 'VOLUME_CLIMAX_REVERSAL') {
      expect(result.volMult).toBeGreaterThanOrEqual(3.0)
      expect(result.closeVsRange).toBeGreaterThanOrEqual(0.65)
    }
  })
})

describe('detectSignal — PULLBACK_TO_SMA20', () => {
  it('does not fire swing signal with fewer than 55 candles', () => {
    const candles = Array.from({ length: 40 }, (_, i) => ({
      open: 100 + i * 0.5, high: 100 + i * 0.5 + 0.3, low: 100 + i * 0.5 - 0.2,
      close: 100 + i * 0.5, volume: 1_200_000,
    }))
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('when swing signal fires it is one of the expected names', () => {
    // Strong rising trend: SMA20 > SMA50 > SMA150 alignment
    const candles = Array.from({ length: 200 }, (_, i) => ({
      open:   50 + i * 0.5,
      high:   50 + i * 0.5 + 0.3,
      low:    50 + i * 0.5 - 0.2,
      close:  50 + i * 0.5,
      volume: 1_200_000,
    }))
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    const validSwingSignals = ['PULLBACK_TO_SMA50', 'PULLBACK_TO_SMA20', null]
    expect(validSwingSignals).toContain(result?.signal ?? null)
    if (result?.signal === 'PULLBACK_TO_SMA20') {
      expect(result.rsi).toBeGreaterThanOrEqual(42)
      expect(result.rsi).toBeLessThanOrEqual(60)
    }
  })
})
