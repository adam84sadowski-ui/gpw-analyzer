import { describe, it, expect } from 'vitest'
import { calculateMACD, getMACDSignal } from '../macd.js'

const prices = Array.from({ length: 60 }, (_, i) => 50 + Math.sin(i * 0.3) * 5)

describe('calculateMACD', () => {
  it('returns macdLine, signal, histogram arrays of same length', () => {
    const { macdLine, signal, histogram } = calculateMACD(prices)
    expect(macdLine.length).toBe(prices.length)
    expect(signal.length).toBe(prices.length)
    expect(histogram.length).toBe(prices.length)
  })

  it('first 25 values of macdLine are null (need EMA26)', () => {
    const { macdLine } = calculateMACD(prices)
    for (let i = 0; i < 25; i++) expect(macdLine[i]).toBeNull()
  })

  it('later values are numbers', () => {
    const { macdLine, histogram } = calculateMACD(prices)
    expect(typeof macdLine[prices.length - 1]).toBe('number')
    expect(typeof histogram[prices.length - 1]).toBe('number')
  })

  it('histogram = macdLine - signal at last index', () => {
    const { macdLine, signal, histogram } = calculateMACD(prices)
    const last = prices.length - 1
    if (macdLine[last] != null && signal[last] != null) {
      expect(histogram[last]).toBeCloseTo(macdLine[last] - signal[last], 3)
    }
  })

  it('returns nulls for insufficient data', () => {
    const { macdLine } = calculateMACD([1, 2, 3])
    expect(macdLine.every(v => v === null)).toBe(true)
  })
})

describe('getMACDSignal', () => {
  it('returns score between -15 and +15', () => {
    const macd = calculateMACD(prices)
    const { score } = getMACDSignal(macd)
    expect(score).toBeGreaterThanOrEqual(-15)
    expect(score).toBeLessThanOrEqual(15)
  })

  it('returns trend bullish when macd > signal', () => {
    // Accelerating uptrend makes EMA12 pull away from EMA26 → MACD > Signal
    const accel = Array.from({ length: 60 }, (_, i) => 10 + i * i * 0.1)
    const macd = calculateMACD(accel)
    const { trend } = getMACDSignal(macd)
    expect(trend).toBe('bullish')
  })

  it('bullish crossover gives +10 pts', () => {
    const macd = {
      macdLine:  [null, null, -0.5, 0.5],
      signal:    [null, null,  0.2, 0.2],
      histogram: [null, null, -0.7, 0.3],
    }
    const { score } = getMACDSignal(macd)
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('bearish crossover gives -10 pts', () => {
    const macd = {
      macdLine:  [null, null, 0.5, -0.5],
      signal:    [null, null, 0.2,  0.2],
      histogram: [null, null, 0.3, -0.7],
    }
    const { score } = getMACDSignal(macd)
    expect(score).toBeLessThanOrEqual(-10)
  })
})
