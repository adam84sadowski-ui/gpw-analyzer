import { describe, it, expect } from 'vitest'
import { swingSignal } from '../../src/strategies/swing.js'

function makeCandles(n, { trend = 'up', basePrice = 100 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
    open:   basePrice + (trend === 'up' ? i * 0.1 : -i * 0.1),
    high:   basePrice + (trend === 'up' ? i * 0.1 + 1 : -i * 0.1 + 1),
    low:    basePrice + (trend === 'up' ? i * 0.1 - 1 : -i * 0.1 - 1),
    close:  basePrice + (trend === 'up' ? i * 0.1 : -i * 0.1),
    volume: 100000 + Math.random() * 50000,
  }))
}

describe('swingSignal', () => {
  it('returns null when not enough data', () => {
    expect(swingSignal(makeCandles(10))).toBeNull()
  })

  it('returns null for downtrend (no SMA cross)', () => {
    const candles = makeCandles(60, { trend: 'down' })
    expect(swingSignal(candles)).toBeNull()
  })
})
