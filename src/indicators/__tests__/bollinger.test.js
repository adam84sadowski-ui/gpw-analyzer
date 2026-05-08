import { describe, it, expect } from 'vitest'
import { calculateBollinger, getBollingerSignal } from '../bollinger.js'

const prices = Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i) * 3)

describe('calculateBollinger', () => {
  it('returns upper > middle > lower', () => {
    const bands = calculateBollinger(prices)
    expect(bands.upper).toBeGreaterThan(bands.middle)
    expect(bands.middle).toBeGreaterThan(bands.lower)
  })

  it('middle equals SMA20', () => {
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20
    const { middle } = calculateBollinger(prices)
    expect(middle).toBeCloseTo(sma20, 1)
  })

  it('returns null for insufficient data', () => {
    expect(calculateBollinger([1, 2, 3], 20)).toBeNull()
  })

  it('bandwidth is positive', () => {
    const { bandwidth } = calculateBollinger(prices)
    expect(bandwidth).toBeGreaterThan(0)
  })
})

describe('getBollingerSignal', () => {
  const bands = { upper: 55, middle: 50, lower: 45, bandwidth: 20 }

  it('price below lower band → +20 score', () => {
    const { score, status } = getBollingerSignal(44, bands)
    expect(score).toBe(20)
    expect(status).toBe('below_lower')
  })

  it('price above upper band → -10 for scalping', () => {
    const { score, status } = getBollingerSignal(56, bands, 'scalping')
    expect(score).toBe(-10)
    expect(status).toBe('above_upper')
  })

  it('price above upper band → +10 for aggressive', () => {
    const { score } = getBollingerSignal(56, bands, 'aggressive')
    expect(score).toBe(10)
  })

  it('consolidation status when bandwidth < 5', () => {
    const tightBands = { upper: 50.5, middle: 50, lower: 49.5, bandwidth: 2 }
    const { status } = getBollingerSignal(50, tightBands)
    expect(status).toBe('consolidation')
  })

  it('returns 0 score when bands are null', () => {
    const { score } = getBollingerSignal(50, null)
    expect(score).toBe(0)
  })
})
