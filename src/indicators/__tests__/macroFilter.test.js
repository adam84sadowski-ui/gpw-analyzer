import { describe, it, expect } from 'vitest'
import { formatMacroLine } from '../macroFilter.js'

// getMacroEnvironment calls external FRED API — tested via formatMacroLine with mocked results

describe('formatMacroLine', () => {
  it('NEUTRALNE → pusty string', () => {
    const macro = { status: 'NEUTRALNE', fedRate: 2.5, cpi: 2.0, scoreAdjustment: 0 }
    expect(formatMacroLine(macro, 'NYSE')).toBe('')
  })

  it('UWAGA → linia z 🟡 i Fed rate', () => {
    const macro = { status: 'UWAGA', fedRate: 4.5, cpi: 3.2, scoreAdjustment: -10 }
    const line = formatMacroLine(macro, 'NYSE')
    expect(line).toContain('🟡')
    expect(line).toContain('UWAGA')
    expect(line).toContain('4.5')
    expect(line).toContain('-10')
  })

  it('RYZYKOWNE → linia z 🔴', () => {
    const macro = { status: 'RYZYKOWNE', fedRate: 5.5, cpi: 4.8, scoreAdjustment: -25 }
    const line = formatMacroLine(macro, 'NYSE')
    expect(line).toContain('🔴')
    expect(line).toContain('RYZYKOWNE')
    expect(line).toContain('-25')
  })

  it('GPW → używa etykiety NBP', () => {
    const macro = { status: 'UWAGA', fedRate: 5.75, cpi: 4.9, scoreAdjustment: -10 }
    const line = formatMacroLine(macro, 'GPW')
    expect(line).toContain('NBP')
    expect(line).toContain('5.75')
  })

  it('null macro → pusty string', () => {
    expect(formatMacroLine(null, 'NYSE')).toBe('')
  })
})
