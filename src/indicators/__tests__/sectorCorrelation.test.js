import { describe, it, expect } from 'vitest'
import { getSector, checkSectorExposure, formatSectorLine } from '../sectorCorrelation.js'

describe('getSector', () => {
  it('PKN → ENERGY (GPW)', () => {
    expect(getSector('pkn.pl', 'GPW')).toBe('ENERGY')
  })

  it('PKO → FINANCE (GPW)', () => {
    expect(getSector('pko.pl', 'GPW')).toBe('FINANCE')
  })

  it('AAPL → TECH (NYSE)', () => {
    expect(getSector('AAPL', 'NYSE')).toBe('TECH')
  })

  it('JPM → FINANCE (NYSE)', () => {
    expect(getSector('JPM', 'NYSE')).toBe('FINANCE')
  })

  it('nieznany ticker → OTHER', () => {
    expect(getSector('xyz.pl', 'GPW')).toBe('OTHER')
  })
})

describe('checkSectorExposure', () => {
  const openPositions = [
    { ticker: 'pko.pl', exchange: 'GPW', status: 'open' },
  ]

  it('brak pozycji w sektorze → brak korekty', () => {
    const r = checkSectorExposure('pkn.pl', 'GPW', openPositions)
    expect(r.block).toBe(false)
    expect(r.reduce).toBe(false)
    expect(r.sector).toBe('ENERGY')
  })

  it('1 pozycja w sektorze → redukcja 50%', () => {
    const r = checkSectorExposure('pzu.pl', 'GPW', openPositions)
    expect(r.block).toBe(false)
    expect(r.reduce).toBe(true)
    expect(r.count).toBe(1)
    expect(r.sector).toBe('FINANCE')
  })

  it('2 pozycje w sektorze → blokada', () => {
    const two = [
      { ticker: 'pko.pl', exchange: 'GPW', status: 'open' },
      { ticker: 'mbk.pl', exchange: 'GPW', status: 'open' },
    ]
    const r = checkSectorExposure('ing.pl', 'GPW', two)
    expect(r.block).toBe(true)
    expect(r.count).toBe(2)
  })

  it('zamknięte pozycje nie liczą się', () => {
    const closed = [{ ticker: 'pko.pl', exchange: 'GPW', status: 'closed' }]
    const r = checkSectorExposure('pzu.pl', 'GPW', closed)
    expect(r.reduce).toBe(false)
    expect(r.block).toBe(false)
  })
})

describe('formatSectorLine', () => {
  it('brak korekty → pusty string', () => {
    expect(formatSectorLine({ block: false, reduce: false, count: 0, sector: 'ENERGY' })).toBe('')
  })

  it('redukcja → ostrzeżenie z sektorem', () => {
    const line = formatSectorLine({ block: false, reduce: true, count: 1, sector: 'FINANCE' })
    expect(line).toContain('FINANCE')
    expect(line).toContain('50%')
  })

  it('blokada → komunikat blokady', () => {
    const line = formatSectorLine({ block: true, reduce: false, count: 2, sector: 'TECH' })
    expect(line).toContain('TECH')
    expect(line).toContain('limit')
  })
})
