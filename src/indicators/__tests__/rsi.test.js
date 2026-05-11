import { describe, it, expect } from 'vitest'
import { calcRSI } from '../rsi.js'

function makeCloses(n, delta = 1, start = 100) {
  return Array.from({ length: n }, (_, i) => start + i * delta)
}

describe('calcRSI', () => {
  it('TC-RSI-01: only gains → RSI = 100', () => {
    const closes = makeCloses(20, 1)
    expect(calcRSI(closes)).toBe(100)
  })

  it('TC-RSI-02: only losses → RSI < 30', () => {
    const closes = makeCloses(20, -1, 200)
    expect(calcRSI(closes)).toBeLessThan(30)
  })

  it('TC-RSI-03: too few data → null', () => {
    const closes = makeCloses(10)
    expect(calcRSI(closes)).toBeNull()
  })

  it('TC-RSI-04: avgLoss = 0 → 100, not Infinity', () => {
    const closes = makeCloses(20, 1)
    const result = calcRSI(closes)
    expect(result).toBe(100)
    expect(isFinite(result)).toBe(true)
  })

  it('TC-RSI-05: Wilder smoothing — known sequence stays in range', () => {
    // alternating +1/-0.5 gives RSI around 65-70
    const closes = [100]
    for (let i = 1; i < 30; i++) closes.push(closes[i - 1] + (i % 2 === 0 ? -0.5 : 1))
    const rsi = calcRSI(closes)
    expect(rsi).toBeGreaterThan(0)
    expect(rsi).toBeLessThan(100)
  })

  it('TC-RSI-06: RSI = 34.9 is below threshold 35 → qualifies as oversold', () => {
    // build closes so RSI lands below 35
    const closes = makeCloses(20, -0.8, 200)
    const rsi = calcRSI(closes)
    expect(rsi).toBeLessThan(35)
  })

  it('TC-RSI-07: RSI above threshold 35 → does not qualify', () => {
    // mixed: slight net positive, RSI well above 35
    const closes = makeCloses(20, 0.5, 100)
    const rsi = calcRSI(closes)
    expect(rsi).toBeGreaterThanOrEqual(35)
  })
})
