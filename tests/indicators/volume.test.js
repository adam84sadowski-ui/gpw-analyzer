import { describe, it, expect } from 'vitest'
import { avgVolume, volumeMultiplier } from '../../src/indicators/volume.js'

function makeVolumes({ days = 22, baseVol = 100000, yesterdayVol = null, todayVol = 5000 } = {}) {
  // days complete trading days + 1 partial today
  const vols = Array.from({ length: days }, (_, i) =>
    i === days - 1 && yesterdayVol != null ? yesterdayVol : baseVol
  )
  vols.push(todayVol)  // today's partial intraday candle
  return vols
}

describe('avgVolume', () => {
  it('returns null when not enough data', () => {
    expect(avgVolume([100, 200], 20)).toBeNull()
  })

  it('excludes the last element (today partial) from average', () => {
    // 20 base days + 1 spike (not last) + 1 huge partial today
    const vols = [...Array(20).fill(100000), 200000, 999_000_000]
    expect(avgVolume(vols, 20)).toBeCloseTo(105000, 0)
  })
})

describe('volumeMultiplier', () => {
  it('returns null when not enough data', () => {
    expect(volumeMultiplier(Array(21).fill(100000))).toBeNull()
  })

  it('returns ~1.0 when yesterday is average', () => {
    const vols = makeVolumes({ days: 22, baseVol: 100000, yesterdayVol: 100000, todayVol: 500 })
    const result = volumeMultiplier(vols)
    expect(result).toBeCloseTo(1.0, 1)
  })

  it('returns ~2.0 when yesterday had 2x average volume', () => {
    const vols = makeVolumes({ days: 22, baseVol: 100000, yesterdayVol: 200000, todayVol: 500 })
    const result = volumeMultiplier(vols)
    expect(result).toBeCloseTo(2.0, 1)
  })

  it('ignores today partial candle regardless of its value', () => {
    const volsSmallToday = makeVolumes({ days: 22, baseVol: 100000, yesterdayVol: 150000, todayVol: 1000 })
    const volsHugeToday  = makeVolumes({ days: 22, baseVol: 100000, yesterdayVol: 150000, todayVol: 999_000_000 })
    expect(volumeMultiplier(volsSmallToday)).toEqual(volumeMultiplier(volsHugeToday))
  })

  it('reflects NVDA-like intraday scenario correctly', () => {
    // simulate 20 days at 100M, yesterday at 120M, today partial at 992K
    const vols = [
      ...Array(20).fill(100_000_000),
      120_000_000,  // yesterday
      992_244,      // today intraday (would give ~0.01 with old bug)
    ]
    const result = volumeMultiplier(vols)
    expect(result).toBeCloseTo(1.2, 1)  // yesterday/avg = 120M/100M
    expect(result).toBeGreaterThan(1.0)
  })
})
