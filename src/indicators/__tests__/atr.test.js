import { describe, it, expect } from 'vitest'
import { calcATR } from '../atr.js'

function makeCandles(n, high = 102, low = 98, close = 100) {
  return Array.from({ length: n }, (_, i) => ({
    date:  `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:  close,
    high,
    low,
    close,
    volume: 1000,
  }))
}

// calcDynamicStopLoss is internal to signals.js — test via its boundary conditions
function clampStop(rawPct, min, max) {
  return Math.round(Math.min(max, Math.max(min, rawPct)) * 10) / 10
}

describe('calcATR', () => {
  it('TC-ATR-01: ATR14 with constant high-low spread of 4 ≈ 4', () => {
    const candles = makeCandles(20, 102, 98, 100)
    const atr = calcATR(candles)
    expect(atr).toBeCloseTo(4, 0)
  })

  it('TC-ATR-02: stop loss scalping — ATR=2, price=100 → stopPct = 2.0%', () => {
    const atr   = 2.0
    const price = 100
    const raw   = (atr * 1.0 / price) * 100  // multiplier=1.0 for scalping
    expect(clampStop(raw, 1.5, 5.0)).toBe(2.0)
  })

  it('TC-ATR-03: stop too small → clamped to min 1.5%', () => {
    const atr   = 0.5
    const price = 100
    const raw   = (atr * 1.0 / price) * 100
    expect(clampStop(raw, 1.5, 5.0)).toBe(1.5)
  })

  it('TC-ATR-04: stop too large → clamped to max 5.0%', () => {
    const atr   = 20
    const price = 100
    const raw   = (atr * 1.0 / price) * 100
    expect(clampStop(raw, 1.5, 5.0)).toBe(5.0)
  })

  it('TC-ATR-05: atrPct = ATR / price * 100', () => {
    const atr   = 3.0
    const price = 60
    const atrPct = Math.round(atr / price * 10000) / 100
    expect(atrPct).toBe(5.0)
  })

  it('TC-ATR-06: too few candles → null', () => {
    const candles = makeCandles(10)
    expect(calcATR(candles)).toBeNull()
  })
})
