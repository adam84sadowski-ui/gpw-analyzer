import { describe, it, expect } from 'vitest'
import { calculateMonthlyReturns, getSeasonalityScore } from '../seasonality.js'

const makePrices = () => {
  const prices = []
  for (let year = 2020; year < 2025; year++) {
    for (let month = 0; month < 12; month++) {
      const base = 50 + month * 0.5
      for (let day = 1; day <= 20; day++) {
        const d = new Date(year, month, day)
        if (d.getDay() === 0 || d.getDay() === 6) continue
        prices.push({
          date:  d.toISOString().slice(0, 10),
          close: base + Math.sin(day) * 0.5,
        })
      }
    }
  }
  return prices
}

describe('calculateMonthlyReturns', () => {
  it('returns object with keys 0-11', () => {
    const returns = calculateMonthlyReturns(makePrices())
    expect(Object.keys(returns).map(Number).sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5,6,7,8,9,10,11])
  })

  it('returns numbers for each month', () => {
    const returns = calculateMonthlyReturns(makePrices())
    for (let m = 0; m < 12; m++) {
      expect(typeof returns[m]).toBe('number')
    }
  })

  it('returns empty object keys as 0 for insufficient data', () => {
    const tiny = [
      { date: '2024-01-02', close: 50 },
      { date: '2024-01-03', close: 51 },
    ]
    const returns = calculateMonthlyReturns(tiny)
    expect(returns[0]).toBe(0)
  })
})

describe('getSeasonalityScore', () => {
  const returns = { 0: 2.5, 1: 0.8, 2: 0.2, 3: -0.8, 4: -2.0, 5: 0 }

  it('strong positive month → +10 pts', () => {
    const { score, avgReturn } = getSeasonalityScore(returns, 0)
    expect(score).toBe(10)
    expect(avgReturn).toBe(2.5)
  })

  it('mild positive month → +5 pts', () => {
    expect(getSeasonalityScore(returns, 1).score).toBe(5)
  })

  it('neutral month → 0 pts', () => {
    expect(getSeasonalityScore(returns, 2).score).toBe(0)
    expect(getSeasonalityScore(returns, 5).score).toBe(0)
  })

  it('mild negative month → -5 pts', () => {
    expect(getSeasonalityScore(returns, 3).score).toBe(-5)
  })

  it('strong negative month → -10 pts', () => {
    expect(getSeasonalityScore(returns, 4).score).toBe(-10)
  })

  it('null monthlyReturns → score 0', () => {
    expect(getSeasonalityScore(null, 0).score).toBe(0)
  })
})
