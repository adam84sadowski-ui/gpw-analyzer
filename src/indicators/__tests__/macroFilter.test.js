import { describe, it, expect, vi, afterEach } from 'vitest'
import { getMacroEnvironment, formatMacroLine } from '../macroFilter.js'

function fredCsvOf(values) {
  return 'DATE,VALUE\n' + values.map((v, i) => `2023-${String(i + 1).padStart(2, '0')}-01,${v}`).join('\n')
}

function mockResponse({ text, json } = {}) {
  return Promise.resolve({
    ok: true,
    text: text ? () => Promise.resolve(text) : undefined,
    json: json ? () => Promise.resolve(json) : undefined,
  })
}

describe('formatMacroLine', () => {
  it('NEUTRALNE → pusty string', () => {
    expect(formatMacroLine({ status: 'NEUTRALNE', fedRate: 2.5, cpi: 2.0, scoreAdjustment: 0 }, 'NYSE')).toBe('')
  })

  it('UWAGA → linia z 🟡 i Fed rate', () => {
    const line = formatMacroLine({ status: 'UWAGA', fedRate: 4.5, cpi: 3.2, scoreAdjustment: -10 }, 'NYSE')
    expect(line).toContain('🟡')
    expect(line).toContain('UWAGA')
    expect(line).toContain('4.5')
    expect(line).toContain('-10')
  })

  it('RYZYKOWNE → linia z 🔴', () => {
    const line = formatMacroLine({ status: 'RYZYKOWNE', fedRate: 5.5, cpi: 4.8, scoreAdjustment: -25 }, 'NYSE')
    expect(line).toContain('🔴')
    expect(line).toContain('RYZYKOWNE')
    expect(line).toContain('-25')
  })

  it('GPW → używa etykiety NBP', () => {
    const line = formatMacroLine({ status: 'UWAGA', fedRate: 5.75, cpi: 4.9, scoreAdjustment: -10 }, 'GPW')
    expect(line).toContain('NBP')
    expect(line).toContain('5.75')
  })

  it('null macro → pusty string', () => {
    expect(formatMacroLine(null, 'NYSE')).toBe('')
  })
})

describe('getMacroEnvironment — NYSE', () => {
  afterEach(() => vi.restoreAllMocks())

  it('TC-MF-01: NEUTRALNE gdy rate=2, cpi=2%', async () => {
    // 14 CPI values: first 13 = 100, last = 102 → YoY ≈ 2%
    const cpiValues = [...Array(13).fill(100), 102]
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf([2.0]) }))
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf(cpiValues) }))
    )
    const r = await getMacroEnvironment('NYSE')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.scoreAdjustment).toBe(0)
    expect(r.source).toBe('FRED')
  })

  it('TC-MF-02: UWAGA gdy rate=4.5, cpi=3.5%', async () => {
    const cpiValues = [...Array(13).fill(100), 103.5]
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf([4.5]) }))
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf(cpiValues) }))
    )
    const r = await getMacroEnvironment('NYSE')
    expect(r.status).toBe('UWAGA')
    expect(r.scoreAdjustment).toBe(-10)
  })

  it('TC-MF-03: RYZYKOWNE gdy rate=5.5, cpi=4.5%', async () => {
    const cpiValues = [...Array(13).fill(100), 104.5]
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf([5.5]) }))
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf(cpiValues) }))
    )
    const r = await getMacroEnvironment('NYSE')
    expect(r.status).toBe('RYZYKOWNE')
    expect(r.scoreAdjustment).toBe(-25)
  })

  it('TC-MF-04: fallback gdy fetch rzuca błąd', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const r = await getMacroEnvironment('NYSE')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.source).toBe('fallback')
    expect(r.fedRate).toBeNull()
  })

  it('TC-MF-05: fallback gdy FRED zwraca !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const r = await getMacroEnvironment('NYSE')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.source).toBe('fallback')
  })

  it('TC-MF-06: fallback gdy CPI ma < 13 wartości', async () => {
    const cpiValues = [100, 102] // only 2 values — too few for YoY
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf([4.5]) }))
      .mockReturnValueOnce(mockResponse({ text: fredCsvOf(cpiValues) }))
    )
    const r = await getMacroEnvironment('NYSE')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.source).toBe('fallback')
  })
})

describe('getMacroEnvironment — GPW', () => {
  afterEach(() => vi.restoreAllMocks())

  const nbpXml = (rate) =>
    `<root><pozycje><stopa id="ref" oprocentowanie="${rate.toString().replace('.', ',')}"/></pozycje></root>`

  it('TC-MF-07: GPW UWAGA gdy NBP=4.5, HICP=3.5', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: nbpXml(4.5) }))
      .mockReturnValueOnce(mockResponse({ json: { value: { '0': 3.5 } } }))
    )
    const r = await getMacroEnvironment('GPW')
    expect(r.status).toBe('UWAGA')
    expect(r.source).toBe('NBP+Eurostat')
    expect(r.fedRate).toBe(4.5)
  })

  it('TC-MF-08: GPW NEUTRALNE gdy NBP=2, HICP=2', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: nbpXml(2.0) }))
      .mockReturnValueOnce(mockResponse({ json: { value: { '0': 2.0 } } }))
    )
    const r = await getMacroEnvironment('GPW')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.scoreAdjustment).toBe(0)
  })

  it('TC-MF-09: GPW fallback gdy fetch rzuca błąd', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const r = await getMacroEnvironment('GPW')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.source).toBe('fallback')
    expect(r.fedRate).toBeNull()
  })

  it('TC-MF-10: GPW fallback gdy NBP XML nie zawiera danych', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: '<root></root>' }))
      .mockReturnValueOnce(mockResponse({ json: { value: { '0': 3.5 } } }))
    )
    const r = await getMacroEnvironment('GPW')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.source).toBe('fallback')
  })

  it('TC-MF-11: GPW fallback gdy Eurostat zwraca puste value', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(mockResponse({ text: nbpXml(4.5) }))
      .mockReturnValueOnce(mockResponse({ json: { value: {} } }))
    )
    const r = await getMacroEnvironment('GPW')
    expect(r.status).toBe('NEUTRALNE')
    expect(r.source).toBe('fallback')
  })
})
