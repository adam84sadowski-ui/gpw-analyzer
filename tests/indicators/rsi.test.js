import { describe, it, expect } from 'vitest'
import { calcRSI } from '../../src/indicators/rsi.js'

describe('calcRSI', () => {
  it('returns null when not enough data', () => {
    expect(calcRSI([1, 2, 3])).toBeNull()
  })

  it('returns 100 when only gains', () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(calcRSI(closes)).toBe(100)
  })

  it('returns 0 when only losses', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 20 - i)
    expect(calcRSI(closes)).toBe(0)
  })

  it('returns ~50 for alternating prices', () => {
    const closes = []
    for (let i = 0; i < 30; i++) closes.push(i % 2 === 0 ? 10 : 11)
    const rsi = calcRSI(closes)
    expect(rsi).toBeGreaterThan(40)
    expect(rsi).toBeLessThan(60)
  })
})
