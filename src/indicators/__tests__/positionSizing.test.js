import { describe, it, expect } from 'vitest'
import { calcPositionSize, formatPositionSizingLine } from '../positionSizing.js'

describe('calcPositionSize', () => {
  it('score < 60 → blocked score_low', () => {
    const r = calcPositionSize(10000, 15, 55)
    expect(r.blocked).toBe(true)
    expect(r.reason).toBe('score_low')
    expect(r.size).toBe(0)
  })

  it('score ≥ 80 → 100% bazy', () => {
    const r = calcPositionSize(10000, 15, 85)
    expect(r.blocked).toBe(false)
    expect(r.scoreMultiplier).toBe(1.0)
    expect(r.size).toBe(1500)
    expect(r.pct).toBe(15)
  })

  it('score 70–79 → 75% bazy', () => {
    const r = calcPositionSize(10000, 15, 75)
    expect(r.blocked).toBe(false)
    expect(r.scoreMultiplier).toBe(0.75)
    expect(r.size).toBe(1125)
  })

  it('score 60–69 → 50% bazy', () => {
    const r = calcPositionSize(10000, 15, 62)
    expect(r.blocked).toBe(false)
    expect(r.scoreMultiplier).toBe(0.50)
    expect(r.size).toBe(750)
  })

  it('drawdown > 15% → blocked drawdown', () => {
    const r = calcPositionSize(10000, 15, 90, 16)
    expect(r.blocked).toBe(true)
    expect(r.reason).toBe('drawdown')
  })

  it('totalExposurePct > 60% → blocked exposure', () => {
    const r = calcPositionSize(10000, 15, 90, 0, 61)
    expect(r.blocked).toBe(true)
    expect(r.reason).toBe('exposure')
  })

  it('drawdown exactly 15% → nie blokuje', () => {
    const r = calcPositionSize(10000, 15, 90, 15)
    expect(r.blocked).toBe(false)
  })
})

describe('formatPositionSizingLine', () => {
  it('blocked → zwraca tekst zablokowania', () => {
    const r = calcPositionSize(10000, 15, 50)
    const line = formatPositionSizingLine(r, 50, 'PLN')
    expect(line).toContain('zablokowana')
  })

  it('active → zawiera kwotę i akcje', () => {
    const r = calcPositionSize(10000, 15, 85)
    const line = formatPositionSizingLine(r, 50, 'PLN')
    expect(line).toMatch(/1.?500/)
    expect(line).toContain('30')
    expect(line).toContain('PLN')
  })
})
