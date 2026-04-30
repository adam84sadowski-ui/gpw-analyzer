import { describe, it, expect } from 'vitest'
import { calcSMA, goldenCross } from '../../src/indicators/sma.js'

describe('calcSMA', () => {
  it('returns null when not enough data', () => {
    expect(calcSMA([1, 2], 20)).toBeNull()
  })

  it('calculates correct average', () => {
    expect(calcSMA([1, 2, 3, 4, 5], 5)).toBe(3)
  })
})

describe('goldenCross', () => {
  it('returns false when not enough data', () => {
    expect(goldenCross([1, 2, 3])).toBe(false)
  })
})
