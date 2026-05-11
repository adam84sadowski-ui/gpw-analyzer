import { describe, it, expect, vi } from 'vitest'
import { calcDynamicTarget, calcDynamicHorizon } from '../../lib/kvHistory.js'

function makeKv(alerts) {
  return {
    keys: vi.fn().mockResolvedValue(alerts.map((_, i) => `key:${i}`)),
    get:  vi.fn().mockImplementation((key) => {
      const idx = parseInt(key.split(':')[1])
      return Promise.resolve(alerts[idx])
    }),
  }
}

describe('calcDynamicTarget', () => {
  it('TC-DT-01: >= 3 winning trades → historical target = avg * 0.8', async () => {
    const alerts = [
      { gainPct: 10, actualGainPct: 10, targetAchieved: true },
      { gainPct: 8,  actualGainPct: 8,  targetAchieved: true },
      { gainPct: 12, actualGainPct: 12, targetAchieved: true },
    ]
    const kv = makeKv(alerts)
    const r  = await calcDynamicTarget(kv, 'pkn.pl', 'swing', 'prod')
    expect(r.source).toBe('historical')
    expect(r.target).toBeCloseTo((10 + 8 + 12) / 3 * 0.8, 1)
  })

  it('TC-DT-02: < 3 winning trades → fallback to default', async () => {
    const alerts = [{ gainPct: 10, actualGainPct: 10, targetAchieved: true }]
    const kv = makeKv(alerts)
    const r  = await calcDynamicTarget(kv, 'pkn.pl', 'swing', 'prod')
    expect(r.source).toBe('default')
    expect(r.target).toBe(15)
  })

  it('TC-DT-03: historical avg × 0.8 clamped to strategy max', async () => {
    // avg = 50% × 0.8 = 40% but swing max = 25%
    const alerts = Array.from({ length: 3 }, () => ({
      actualGainPct: 50, targetAchieved: true,
    }))
    const kv = makeKv(alerts)
    const r  = await calcDynamicTarget(kv, 'pkn.pl', 'swing', 'prod')
    expect(r.target).toBe(25)
  })

  it('TC-DT-04: no keys → fallback default', async () => {
    const kv = { keys: vi.fn().mockResolvedValue([]) }
    const r  = await calcDynamicTarget(kv, 'pkn.pl', 'scalping', 'prod')
    expect(r.source).toBe('default')
    expect(r.target).toBe(5)
  })
})

describe('calcDynamicHorizon', () => {
  it('TC-DT-05: >= 3 trades with daysHeld → historical horizon range', async () => {
    const alerts = [
      { daysHeld: 10, targetAchieved: true },
      { daysHeld: 8,  targetAchieved: true },
      { daysHeld: 12, targetAchieved: true },
    ]
    const kv = makeKv(alerts)
    const r  = await calcDynamicHorizon(kv, 'pkn.pl', 'scalping', 'prod')
    expect(r.source).toBe('historical')
    // avg=10, minD=floor(10*0.6)=6, maxD=ceil(10*1.5)=15
    expect(r.horizon).toContain('6')
  })

  it('TC-DT-06: no data → fallback default horizon string', async () => {
    const kv = { keys: vi.fn().mockResolvedValue([]) }
    const r  = await calcDynamicHorizon(kv, 'pkn.pl', 'scalping', 'prod')
    expect(r.source).toBe('default')
    expect(typeof r.horizon).toBe('string')
  })
})
