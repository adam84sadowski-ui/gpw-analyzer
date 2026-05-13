import { describe, it, expect } from 'vitest'
import { runGEMAlgorithm, calculateReturn12m, isLastBusinessDay, nextReviewDate, simulateGEM } from '../gem.js'

const CASH_RATE = 0.05  // 5%

// Build mock daily candles: start price 12+ months ago, end price today
function mockCandles(startPrice, endPrice, monthsAgo = 13) {
  const now  = new Date()
  const then = new Date(now)
  then.setMonth(then.getMonth() - monthsAgo)
  const mid  = new Date((now.getTime() + then.getTime()) / 2)
  return [
    { date: then.toISOString().slice(0, 10), close: startPrice },
    { date: mid.toISOString().slice(0, 10),  close: (startPrice + endPrice) / 2 },
    { date: now.toISOString().slice(0, 10),  close: endPrice },
  ]
}

// ── calculateReturn12m ──────────────────────────────────────────────────

describe('calculateReturn12m', () => {
  it('returns correct fraction for +20% gain', () => {
    const r = calculateReturn12m(mockCandles(100, 120))
    expect(r).toBeCloseTo(0.2, 1)
  })

  it('returns correct fraction for -10% loss', () => {
    const r = calculateReturn12m(mockCandles(100, 90))
    expect(r).toBeCloseTo(-0.1, 1)
  })

  it('returns null for empty or null input', () => {
    expect(calculateReturn12m([])).toBeNull()
    expect(calculateReturn12m(null)).toBeNull()
  })
})

// ── runGEMAlgorithm ──────────────────────────────────────────────────────

describe('runGEMAlgorithm', () => {
  it('Scenario A: CSPX below cash → bonds (AGGH)', () => {
    const cspx = mockCandles(100, 96)   // -4%
    const swrd = mockCandles(100, 110)  // +10%
    const r = runGEMAlgorithm(cspx, swrd, CASH_RATE)
    expect(r.decision).toBe('bonds')
    expect(r.etf).toBe('AGGH')
    expect(r.step1Passed).toBe(false)
    expect(r.swrd12m).toBeNull()
  })

  it('Scenario B: CSPX above cash, SWRD stronger → world (SWRD)', () => {
    const cspx = mockCandles(100, 112)  // +12%
    const swrd = mockCandles(100, 125)  // +25%
    const r = runGEMAlgorithm(cspx, swrd, CASH_RATE)
    expect(r.decision).toBe('world')
    expect(r.etf).toBe('SWRD')
    expect(r.step1Passed).toBe(true)
  })

  it('Scenario C: CSPX above cash, CSPX stronger → usa (CSPX)', () => {
    const cspx = mockCandles(100, 122)  // +22%
    const swrd = mockCandles(100, 110)  // +10%
    const r = runGEMAlgorithm(cspx, swrd, CASH_RATE)
    expect(r.decision).toBe('usa')
    expect(r.etf).toBe('CSPX')
    expect(r.step1Passed).toBe(true)
  })

  it('returns null when CSPX candles unavailable', () => {
    expect(runGEMAlgorithm(null, mockCandles(100, 110), CASH_RATE)).toBeNull()
    expect(runGEMAlgorithm([],   mockCandles(100, 110), CASH_RATE)).toBeNull()
  })

  it('includes timestamps and lookback in result', () => {
    const r = runGEMAlgorithm(mockCandles(100, 115), mockCandles(100, 108), CASH_RATE, 12)
    expect(r.lookback).toBe(12)
    expect(r.timestamp).toBeTruthy()
    expect(r.cashRate).toBe(CASH_RATE)
  })
})

// ── isLastBusinessDay ────────────────────────────────────────────────────

describe('isLastBusinessDay', () => {
  it('returns false for Saturday', () => {
    // Jan 31 2026 = Saturday
    expect(isLastBusinessDay(new Date(2026, 0, 31))).toBe(false)
  })

  it('returns false for Sunday', () => {
    expect(isLastBusinessDay(new Date(2026, 0, 25))).toBe(false)
  })

  it('returns true for last Friday of month (Jan 30, 2026)', () => {
    // Jan 31 2026 is Saturday, so last business day is Jan 30 (Friday)
    expect(isLastBusinessDay(new Date(2026, 0, 30))).toBe(true)
  })

  it('returns false for non-last business day', () => {
    expect(isLastBusinessDay(new Date(2026, 0, 29))).toBe(false)  // Thursday, not last
  })

  it('handles month ending on Friday (Apr 30, 2027)', () => {
    // Apr 30 2027 is a Friday — last business day
    expect(isLastBusinessDay(new Date(2027, 3, 30))).toBe(true)
  })
})

// ── nextReviewDate ────────────────────────────────────────────────────────

describe('nextReviewDate', () => {
  it('returns a future date string in YYYY-MM-DD format', () => {
    const d = nextReviewDate(new Date(2026, 0, 15))
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(d) > new Date(2026, 0, 15)).toBe(true)
  })

  it('returns a weekday', () => {
    const d = new Date(nextReviewDate(new Date(2026, 0, 15)))
    expect(d.getDay()).not.toBe(0)
    expect(d.getDay()).not.toBe(6)
  })
})

// ── simulateGEM ───────────────────────────────────────────────────────────

describe('simulateGEM', () => {
  // Build 3 years of monthly-ish candles for simulation
  function monthlyCandles(annualReturnPct, months = 36) {
    const candles = []
    const monthlyRet = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1
    let price = 100
    for (let i = months; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      d.setDate(28)  // stable date within month
      candles.push({ date: d.toISOString().slice(0, 10), close: Math.round(price * 100) / 100 })
      price *= 1 + monthlyRet
    }
    return candles
  }

  it('returns equity curve with gem, vwce, cspx series', () => {
    const result = simulateGEM(
      monthlyCandles(15), monthlyCandles(12),
      monthlyCandles(5),  monthlyCandles(10),
      { cashRate: 0.05, lookback: 12, gemPct: 0.7 }
    )
    expect(result).not.toBeNull()
    expect(result.curve.length).toBeGreaterThan(0)
    expect(result.curve[0]).toHaveProperty('gem')
    expect(result.curve[0]).toHaveProperty('vwce')
    expect(result.curve[0]).toHaveProperty('cspx')
    expect(result.curve[0]).toHaveProperty('date')
  })

  it('returns null with insufficient data', () => {
    expect(simulateGEM([], [], [], [], {})).toBeNull()
  })
})
