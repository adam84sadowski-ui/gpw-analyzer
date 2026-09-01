import { describe, it, expect } from 'vitest'
import { calcScore } from '../scoring.js'

const base = {
  rsi: 28, volMult: 2.0, sma150trend: 'above', nearSupport: 48,
  divergence: 'bullish', indexTrend: 'up',
  macdScore: 0, bollingerScore: 0, seasonalityScore: 0,
}

describe('calcScore', () => {
  it('returns number between 0 and 100', () => {
    const score = calcScore('scalping', base)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('perfect scalping signal scores high', () => {
    const score = calcScore('scalping', {
      ...base, macdScore: 15, bollingerScore: 20, seasonalityScore: 10,
    })
    expect(score).toBeGreaterThanOrEqual(70)
  })

  it('bearish MACD reduces score', () => {
    const neutral = calcScore('scalping', { ...base, macdScore: 0 })
    const bearish  = calcScore('scalping', { ...base, macdScore: -15 })
    expect(bearish).toBeLessThan(neutral)
  })

  it('bad seasonality reduces score', () => {
    const good = calcScore('scalping', { ...base, seasonalityScore: 10 })
    const bad  = calcScore('scalping', { ...base, seasonalityScore: -10 })
    expect(bad).toBeLessThan(good)
  })

  it('score never goes below 0', () => {
    const score = calcScore('scalping', {
      rsi: 50, volMult: 0.5, sma150trend: 'below', nearSupport: null,
      divergence: null, indexTrend: 'down',
      macdScore: -15, bollingerScore: -20, seasonalityScore: -10,
    })
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('score never exceeds 100', () => {
    const score = calcScore('scalping', {
      ...base, rsi: 20, volMult: 5, macdScore: 15, bollingerScore: 20, seasonalityScore: 10,
    })
    expect(score).toBeLessThanOrEqual(100)
  })

  it('aggressive ignores support in scoring', () => {
    const withSupport    = calcScore('aggressive', { ...base, nearSupport: 48 })
    const withoutSupport = calcScore('aggressive', { ...base, nearSupport: null })
    expect(withSupport).toBe(withoutSupport)
  })

  it('swing does not use RSI', () => {
    const lowRsi  = calcScore('swing', { ...base, rsi: 20 })
    const highRsi = calcScore('swing', { ...base, rsi: 70 })
    expect(lowRsi).toBe(highRsi)
  })

  describe('rsScore — aggressive post-normalization', () => {
    const aggrBase = {
      rsi: 62, volMult: 2.5, sma150trend: 'above', nearSupport: null,
      divergence: null, indexTrend: 'up',
      macdScore: 10, bollingerScore: 5, seasonalityScore: 0,
    }

    it('leader (+rsScore=10) scores higher than neutral for aggressive', () => {
      const neutral = calcScore('aggressive', { ...aggrBase, rsScore: 0 })
      const leader  = calcScore('aggressive', { ...aggrBase, rsScore: 10 })
      expect(leader).toBeGreaterThan(neutral)
    })

    it('laggard (rsScore=-10) scores lower than neutral for aggressive', () => {
      const neutral = calcScore('aggressive', { ...aggrBase, rsScore: 0 })
      const laggard = calcScore('aggressive', { ...aggrBase, rsScore: -10 })
      expect(laggard).toBeLessThan(neutral)
    })

    it('rsScore has no effect on scalping', () => {
      const noRs   = calcScore('scalping', { ...base, rsScore: 0 })
      const leader = calcScore('scalping', { ...base, rsScore: 10 })
      expect(leader).toBe(noRs)
    })

    it('rsScore has no effect on swing', () => {
      const noRs   = calcScore('swing', { ...base, rsScore: 0 })
      const leader = calcScore('swing', { ...base, rsScore: 10 })
      expect(leader).toBe(noRs)
    })

    it('aggressive score stays within 0-100 with extreme rsScore', () => {
      const high = calcScore('aggressive', { ...aggrBase, rsScore: 10, macdScore: 15, bollingerScore: 20, seasonalityScore: 10 })
      const low  = calcScore('aggressive', { ...aggrBase, rsScore: -10, macdScore: -15, bollingerScore: -20, seasonalityScore: -10 })
      expect(high).toBeLessThanOrEqual(100)
      expect(low).toBeGreaterThanOrEqual(0)
    })
  })
})
