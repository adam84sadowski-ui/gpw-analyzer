import { describe, it, expect } from 'vitest'
import { calcTrailingStop } from '../../lib/trailingStop.js'

describe('calcTrailingStop', () => {
  it('TC-TS-01: trailing stop rises when price makes new high', () => {
    // entry=100, HWM=100, new price=105, stopPct=2%
    const r = calcTrailingStop(100, 105, 100, 0.02, 0.10)
    expect(r).not.toBeNull()
    expect(r.newHWM).toBe(105)
    expect(r.trailingStop).toBe(102.9)  // 105 * 0.98
  })

  it('TC-TS-02: returns null when price does not exceed HWM (stop does not retreat)', () => {
    // current price 103 < HWM 105 → no update
    const r = calcTrailingStop(100, 103, 105, 0.02, 0.10)
    expect(r).toBeNull()
  })

  it('TC-TS-03: break-even NOT activated when P&L < 50% of target', () => {
    // entry=100, target=10%, P&L=4.9% → 50% of target = 5%
    const r = calcTrailingStop(100, 104.9, 100, 0.02, 0.10)
    expect(r.breakEven).toBeNull()
    expect(r.effectiveStop).toBe(r.trailingStop)
  })

  it('TC-TS-04: break-even activated when P&L >= 50% of target', () => {
    // entry=100, target=10%, P&L=5.1% → break-even = 100
    const r = calcTrailingStop(100, 105.1, 100, 0.02, 0.10)
    expect(r.breakEven).toBe(100)
    expect(r.effectiveStop).toBeGreaterThanOrEqual(100)
  })

  it('TC-TS-05: effectiveStop = max(trailingStop, breakEven)', () => {
    // entry=100, target=10%, price=106, stopPct=2%
    // trailing = 106*0.98 = 103.88, breakEven = 100
    // effectiveStop = max(103.88, 100) = 103.88
    const r = calcTrailingStop(100, 106, 100, 0.02, 0.10)
    expect(r.effectiveStop).toBe(Math.max(r.trailingStop, r.breakEven ?? 0))
  })
})
