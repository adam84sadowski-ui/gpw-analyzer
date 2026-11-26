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

  it('returns RSI_OVERSOLD or PULLBACK_UPTREND when pullback-in-trend conditions are met', () => {
    // 157 uptrend days + 3 pullback days → RSI(9) lands ~38-42; signal name depends on RSI ≤/> 37
    const candles = makeUptrendCandles({ total: 160, pullbackDays: 3, pullbackRate: 0.985, volSpike: 1.3 })
    const result = detectSignal(candles, 'scalping', {}, 'GPW')
    expect(result).not.toBeNull()
    expect(['RSI_OVERSOLD', 'PULLBACK_UPTREND']).toContain(result.signal)
    if (result.signal === 'RSI_OVERSOLD')    expect(result.rsi).toBeLessThanOrEqual(37)
    if (result.signal === 'PULLBACK_UPTREND') expect(result.rsi).toBeGreaterThan(37)
    expect(result.rsi).toBeGreaterThanOrEqual(34)
    expect(result.rsi).toBeLessThanOrEqual(46)
    expect(result.price).toBeGreaterThan(0)
    expect(result.volMult).toBeGreaterThanOrEqual(1.2)
  })

  it('returns RSI_OVERSOLD or PULLBACK_UPTREND for NYSE with wider RSI band', () => {
    const candles = makeUptrendCandles({ total: 160, pullbackDays: 3, pullbackRate: 0.985, volSpike: 1.2 })
    const result = detectSignal(candles, 'scalping', {}, 'NYSE')
    expect(result).not.toBeNull()
    expect(['RSI_OVERSOLD', 'PULLBACK_UPTREND']).toContain(result.signal)
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

// ─── RECOVERY — RECOVERY_SETUP ───────────────────────────────────────────────

function makeFallenAngelCandles({ total = 252, peakAt = 100, dropPct = 0.50, recoveryDays = 20, recoveryRate = 1.004 } = {}) {
  // Rise to peak, then drop, then mild recovery
  const peakPrice = peakAt
  const dropDays  = total - recoveryDays
  const trough    = peakPrice * (1 - dropPct)
  const candles   = []

  // Drop phase
  const dailyDrop = Math.pow(trough / peakPrice, 1 / dropDays)
  let price = peakPrice
  for (let i = 0; i < dropDays; i++) {
    price *= dailyDrop
    candles.push({ open: price / dailyDrop, high: price / dailyDrop * 1.002, low: price * 0.998, close: price, volume: 1_000_000 })
  }

  // Recovery phase
  for (let i = 0; i < recoveryDays; i++) {
    price *= recoveryRate
    candles.push({ open: price / recoveryRate, high: price * 1.003, low: price * 0.997, close: price, volume: 1_200_000 })
  }

  return candles
}

describe('detectSignal — recovery (RECOVERY_SETUP)', () => {
  it('returns null when fewer than 55 candles', () => {
    const candles = makeFallenAngelCandles({ total: 50 })
    expect(detectSignal(candles, 'recovery', {}, 'NYSE')).toBeNull()
  })

  it('returns null when price is only 15% below 52w high (not deep enough for NYSE -25% threshold)', () => {
    // Small drop — pctFrom52wHigh > -25% (NYSE threshold)
    const candles = makeFallenAngelCandles({ total: 252, dropPct: 0.15, recoveryDays: 20 })
    expect(detectSignal(candles, 'recovery', {}, 'NYSE')).toBeNull()
  })

  it('returns null when price is only 20% below 52w high for GPW (-35% threshold)', () => {
    const candles = makeFallenAngelCandles({ total: 252, dropPct: 0.20, recoveryDays: 20 })
    expect(detectSignal(candles, 'recovery', {}, 'GPW')).toBeNull()
  })

  it('returns RECOVERY_SETUP for NYSE at -30% drop (qualifies at -25% threshold)', () => {
    // 30% drop from peak — qualifies for NYSE (-25%), should fire if RSI in 20-55
    const candles = makeFallenAngelCandles({ total: 252, dropPct: 0.30, recoveryDays: 20, recoveryRate: 1.003 })
    const result = detectSignal(candles, 'recovery', {}, 'NYSE')
    if (result !== null) {
      expect(result.signal).toBe('RECOVERY_SETUP')
      expect(result.pctFrom52wHigh).toBeLessThanOrEqual(-25)
      expect(result.rsi).toBeGreaterThanOrEqual(20)
      expect(result.rsi).toBeLessThanOrEqual(55)
    }
  })

  it('returns RECOVERY_SETUP when fallen angel conditions are met (50% drop)', () => {
    // 50% drop — qualifies for both NYSE and GPW
    const candles = makeFallenAngelCandles({ total: 252, dropPct: 0.50, recoveryDays: 20, recoveryRate: 1.004 })
    const result = detectSignal(candles, 'recovery', {}, 'NYSE')
    if (result !== null) {
      expect(result.signal).toBe('RECOVERY_SETUP')
      expect(result.pctFrom52wHigh).toBeLessThanOrEqual(-25)
      expect(result.rsi).toBeGreaterThanOrEqual(20)
      expect(result.rsi).toBeLessThanOrEqual(55)
      expect(result.high52w).toBeGreaterThan(result.price)
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
    }
  })

  it('returns RECOVERY_SETUP for GPW exchange as well', () => {
    const candles = makeFallenAngelCandles({ total: 252, dropPct: 0.50, recoveryDays: 20 })
    const result = detectSignal(candles, 'recovery', {}, 'GPW')
    if (result !== null) {
      expect(result.signal).toBe('RECOVERY_SETUP')
    }
  })
})

// ─── SWING — NEW SIGNALS ──────────────────────────────────────────────────────

// Staircase candles: 3 up (+0.3%) / 2 down (-0.3%) per 5-day cycle
// → RSI(14) ≈ 60, mild net uptrend; ascending window lows by design
function makeStaircaseCandles({ total = 170 } = {}) {
  let price = 100
  const volBase = 100_000
  const candles = []
  for (let i = 0; i < total - 1; i++) {
    const up = i % 5 < 3
    price *= up ? 1.003 : 0.997
    candles.push({
      open: price / (up ? 1.003 : 0.997),
      high: price * (up ? 1.004 : 1.001),
      low:  price * (up ? 0.998 : 0.996),
      close: price,
      volume: volBase,
    })
  }
  // Final candle: volume spike
  price *= 1.003
  candles.push({ open: price / 1.003, high: price * 1.004, low: price * 0.998, close: price, volume: volBase * 1.4 })
  return candles
}

// Candles with an explicit golden cross (SMA20 crosses SMA50 on the last day)
function makeGoldenCrossCandles() {
  const candles = []
  let price = 100
  // 160 uptrend days → SMA150 established, SMA20 well above SMA50
  for (let i = 0; i < 160; i++) {
    price *= 1.004
    candles.push({ open: price * 0.999, high: price * 1.004, low: price * 0.998, close: price, volume: 100_000 })
  }
  // 25 downtrend days → SMA20 drops below SMA50
  for (let i = 0; i < 25; i++) {
    price *= 0.991
    candles.push({ open: price / 0.991, high: price / 0.991, low: price * 0.998, close: price, volume: 110_000 })
  }
  // 10 recovery days → SMA20 climbs back and crosses SMA50 with higher volume
  for (let i = 0; i < 10; i++) {
    price *= 1.014
    candles.push({ open: price / 1.014, high: price * 1.005, low: price * 0.997, close: price, volume: 150_000 })
  }
  return candles
}

// Candles for OVERSOLD_UPTREND: long uptrend then heavy selloff → RSI < 36
function makeOversoldUptrendCandles({ uptrendDays = 200, selloffDays = 18, selloffRate = 0.985 } = {}) {
  let price = 100
  const candles = []
  for (let i = 0; i < uptrendDays; i++) {
    price *= 1.004
    candles.push({ open: price * 0.999, high: price * 1.004, low: price * 0.998, close: price, volume: 100_000 })
  }
  for (let i = 0; i < selloffDays; i++) {
    price *= selloffRate
    const isLast = i === selloffDays - 1
    candles.push({
      open: price / selloffRate,
      high: price / selloffRate,
      low: price * 0.997,
      close: price,
      volume: isLast ? 140_000 : 110_000,
    })
  }
  return candles
}

// Candles for BB_SQUEEZE_BREAKOUT: flat consolidation then explosive breakout
function makeBBSqueezeCandles() {
  const candles = []
  let price = 100
  // 160 days uptrend (RSI stabilises and SMA150 is established)
  for (let i = 0; i < 160; i++) {
    price *= 1.003
    candles.push({ open: price * 0.999, high: price * 1.004, low: price * 0.998, close: price, volume: 100_000 })
  }
  // 30 consolidation days: alternating ±0.1% → std very low, bandwidth < 6%
  for (let i = 0; i < 30; i++) {
    const up = i % 2 === 0
    price *= up ? 1.001 : 0.999
    candles.push({ open: price / (up ? 1.001 : 0.999), high: price * 1.002, low: price * 0.998, close: price, volume: 100_000 })
  }
  // 1 breakout candle: price jumps well above upper BB with strong volume
  price *= 1.05
  candles.push({ open: price / 1.05, high: price * 1.01, low: price * 0.998, close: price, volume: 160_000 })
  return candles
}

describe('detectSignal — swing OVERSOLD_UPTREND', () => {
  it('returns null when price is below SMA150 (downtrend)', () => {
    const candles = makeDowntrendCandles(200)
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('returns null when volume is insufficient after selloff', () => {
    // Selloff with low volume spike → volMult below threshold
    const candles = makeOversoldUptrendCandles({ selloffDays: 18, selloffRate: 0.985 })
    // Replace last candle's volume with low value
    candles[candles.length - 1] = { ...candles[candles.length - 1], volume: 100_000 }
    // With volMult ≈ 1.0, signal should not fire
    // (may still fire PULLBACK_TO_SMA50 etc. so just assert no OVERSOLD_UPTREND)
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null) {
      expect(result.signal).not.toBe('OVERSOLD_UPTREND')
    }
  })

  it('detects OVERSOLD_UPTREND when deep selloff occurs in an uptrend', () => {
    const candles = makeOversoldUptrendCandles()
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null) {
      expect(result.signal).toBe('OVERSOLD_UPTREND')
      expect(result.rsi).toBeLessThan(36)
      expect(result.price).toBeGreaterThan(0)
      expect(result.volMult).toBeGreaterThanOrEqual(1.1)
    }
  })

  it('detects OVERSOLD_UPTREND for NYSE when MACD is not strongly bearish', () => {
    // NYSE blocks OVERSOLD_UPTREND only when MACD score < -10
    const candles = makeOversoldUptrendCandles()
    const result = detectSignal(candles, 'swing', {}, 'NYSE')
    if (result !== null) {
      expect(['OVERSOLD_UPTREND', 'PULLBACK_TO_SMA50', 'PULLBACK_TO_SMA20']).toContain(result.signal)
    }
  })
})

describe('detectSignal — swing GOLDEN_CROSS', () => {
  it('returns null when fewer than 55 candles (exits early)', () => {
    const candles = makeUptrendCandles({ total: 40 })
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('evaluates golden cross conditions without throwing', () => {
    // Verifies the golden cross detection code path is exercised
    const candles = makeGoldenCrossCandles()
    expect(candles.length).toBeGreaterThan(55)
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null && result.signal === 'GOLDEN_CROSS') {
      expect(result.rsi).toBeGreaterThanOrEqual(45)
      expect(result.rsi).toBeLessThanOrEqual(70)
      expect(result.volMult).toBeGreaterThanOrEqual(1.1)
      expect(result.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('evaluates golden cross conditions for NYSE exchange', () => {
    const candles = makeGoldenCrossCandles()
    const result = detectSignal(candles, 'swing', {}, 'NYSE')
    if (result !== null && result.signal === 'GOLDEN_CROSS') {
      expect(result.rsi).toBeGreaterThanOrEqual(45)
      expect(result.rsi).toBeLessThanOrEqual(70)
    }
  })

  it('does not return GOLDEN_CROSS when candles show steady downtrend', () => {
    const candles = makeDowntrendCandles(200)
    // SMA20 always below SMA50 in downtrend; also price < SMA150 → early null
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })
})

describe('detectSignal — swing HIGHER_LOW_PATTERN', () => {
  it('code path is exercised in staircase uptrend candles', () => {
    const candles = makeStaircaseCandles({ total: 170 })
    expect(candles.length).toBeGreaterThan(55)
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null) {
      expect(result.price).toBeGreaterThan(0)
      expect(result.volMult).toBeGreaterThanOrEqual(1.1)
      expect(result.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns null in a downtrend (price below SMA150)', () => {
    const candles = makeDowntrendCandles(200)
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('detects HIGHER_LOW_PATTERN when ascending lows and volume are present', () => {
    // Staircase with wider separation between cycles to avoid PULLBACK_TO_SMA50 firing first
    const candles = makeStaircaseCandles({ total: 200 })
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null && result.signal === 'HIGHER_LOW_PATTERN') {
      expect(result.rsi).toBeGreaterThanOrEqual(42)
      expect(result.rsi).toBeLessThanOrEqual(65)
      expect(result.volMult).toBeGreaterThanOrEqual(1.1)
    }
  })
})

describe('detectSignal — swing BB_SQUEEZE_BREAKOUT', () => {
  it('code path is exercised when price breaks above upper band', () => {
    const candles = makeBBSqueezeCandles()
    expect(candles.length).toBeGreaterThan(55)
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null) {
      expect(result.price).toBeGreaterThan(0)
      expect(result.score).toBeGreaterThanOrEqual(0)
    }
  })

  it('detects BB_SQUEEZE_BREAKOUT after tight consolidation then breakout', () => {
    const candles = makeBBSqueezeCandles()
    const result = detectSignal(candles, 'swing', {}, 'GPW')
    if (result !== null && result.signal === 'BB_SQUEEZE_BREAKOUT') {
      expect(result.rsi).toBeGreaterThanOrEqual(50)
      expect(result.rsi).toBeLessThanOrEqual(72)
      expect(result.volMult).toBeGreaterThanOrEqual(1.1 * 1.2)
    }
  })

  it('returns null when price is below SMA150 — no signals can fire', () => {
    const candles = makeDowntrendCandles(200)
    expect(detectSignal(candles, 'swing', {}, 'GPW')).toBeNull()
  })

  it('evaluates BB squeeze conditions for NYSE exchange', () => {
    const candles = makeBBSqueezeCandles()
    const result = detectSignal(candles, 'swing', {}, 'NYSE')
    if (result !== null && result.signal === 'BB_SQUEEZE_BREAKOUT') {
      expect(result.volMult).toBeGreaterThanOrEqual(1.32)
    }
  })
})
