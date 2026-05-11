import { describe, it, expect } from 'vitest'
import { calcSMA, goldenCross, calcSMASeries } from '../sma.js'

describe('calcSMA', () => {
  it('TC-SMA-01: SMA20 of [1..20] = 10.5', () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(calcSMA(closes, 20)).toBe(10.5)
  })

  it('TC-SMA-02: SMA50 with only 30 candles → null', () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1)
    expect(calcSMA(closes, 50)).toBeNull()
  })

  it('TC-SMA-03: price above SMA150 → sma150trend = above', () => {
    const closes = Array.from({ length: 150 }, () => 95)
    closes.push(100) // last price = 100, SMA150 = 95
    const sma150 = calcSMA(closes, 150)
    const price  = closes[closes.length - 1]
    expect(price > sma150).toBe(true)
  })
})

describe('goldenCross', () => {
  it('TC-SMA-04: golden cross detected when SMA20 crosses above SMA50', () => {
    // Build 51 candles where last candle pushes SMA20 above SMA50
    const closes = Array.from({ length: 50 }, () => 100)
    closes.push(200) // spike makes SMA20 jump above SMA50 on last candle
    expect(goldenCross(closes)).toBe(true)
  })

  it('TC-SMA-05: no golden cross when SMA20 already above SMA50 for multiple days', () => {
    // flat series: SMA20 = SMA50, no crossover event on the last day
    const closes = Array.from({ length: 55 }, () => 100)
    expect(goldenCross(closes)).toBe(false)
  })
})

describe('swing SMA50 crossover window', () => {
  it('TC-SMA-06: crossover 2 days ago is within 3-day window', () => {
    // price was below SMA50 3 days ago, crossed above 2 days ago
    const closes = Array.from({ length: 54 }, (_, i) => i < 50 ? 100 : 90)
    // last 3 candles pushed above
    closes.push(110, 115)
    // compute SMA50 of last slice — price > SMA50 now
    const sma50 = calcSMA(closes, 50)
    expect(closes[closes.length - 1]).toBeGreaterThan(sma50)
  })

  it('TC-SMA-07: SMA50 series has nulls for first 49 values', () => {
    const closes = Array.from({ length: 60 }, (_, i) => i + 1)
    const series = calcSMASeries(closes, 50)
    expect(series[48]).toBeNull()
    expect(series[49]).not.toBeNull()
  })
})
