import { describe, it, expect } from 'vitest'
import { interpretPositionState } from '../interpretSignal.js'

const BASE_POS = {
  signal:            'BREAKOUT',
  entryPrice:        5.74,
  stopLoss:          8,
  trailingActive:    false,
  trailingStopPrice: null,
}

const GOOD_CUR = { rsi: 65, volMult: 2.5, sma50Delta: 5 }
const DOWN_CUR = { rsi: 54, volMult: 4.5, sma50Delta: 2.55 }

// ── Priority 1: trailing stop override ────────────────────────────────────

describe('interpretPositionState — trailing stop override', () => {
  it('returns EXIT when price <= trailingStopPrice', () => {
    const pos = { ...BASE_POS, trailingActive: true, trailingStopPrice: 5.44 }
    const result = interpretPositionState(pos, 5.42, DOWN_CUR)
    expect(result).toMatch(/⛔/)
    expect(result).toMatch(/Trailing stop/)
    expect(result).toMatch(/Zamknij/)
  })

  it('returns EXIT when price == trailingStopPrice exactly', () => {
    const pos = { ...BASE_POS, trailingActive: true, trailingStopPrice: 5.44 }
    const result = interpretPositionState(pos, 5.44, DOWN_CUR)
    expect(result).toMatch(/⛔/)
  })

  it('does NOT trigger when price > trailingStopPrice', () => {
    const pos = { ...BASE_POS, trailingActive: true, trailingStopPrice: 5.44 }
    const result = interpretPositionState(pos, 5.60, GOOD_CUR)
    expect(result).not.toMatch(/⛔.*Trailing/)
  })
})

// ── Priority 1: static stop override ─────────────────────────────────────

describe('interpretPositionState — static stop override', () => {
  it('returns EXIT when price <= entryPrice * (1 - stopLoss/100)', () => {
    // 5.74 * 0.92 = 5.2808
    const result = interpretPositionState(BASE_POS, 5.20, DOWN_CUR)
    expect(result).toMatch(/⛔/)
    expect(result).toMatch(/Stop loss/)
  })

  it('does NOT trigger when trailingActive but trailingStopPrice is null', () => {
    const pos = { ...BASE_POS, trailingActive: true, trailingStopPrice: null }
    // price below static stop
    const result = interpretPositionState(pos, 5.20, DOWN_CUR)
    expect(result).toMatch(/⛔.*Stop loss/)
  })
})

// ── Priority 2: volume direction ──────────────────────────────────────────

describe('interpretPositionState — volume direction', () => {
  it('BREAKOUT: flags failed breakout when price < entry AND volMult >= 2', () => {
    const result = interpretPositionState(BASE_POS, 5.50, DOWN_CUR)
    expect(result).toMatch(/Wybicie zanegowane/)
    expect(result).toMatch(/presja sprzedających/)
  })

  it('non-BREAKOUT: warns selling pressure when price < entry AND volMult >= 2', () => {
    const pos = { ...BASE_POS, signal: 'RSI_OVERSOLD' }
    const result = interpretPositionState(pos, 5.50, DOWN_CUR)
    expect(result).toMatch(/presja sprzedających/)
    expect(result).not.toMatch(/Wybicie/)
  })

  it('does NOT warn when price > entry even with high volume', () => {
    const result = interpretPositionState(BASE_POS, 6.00, { rsi: 65, volMult: 4, sma50Delta: 8 })
    expect(result).not.toMatch(/presja sprzedających/)
  })
})

// ── Priority 3: premise validation ───────────────────────────────────────

describe('interpretPositionState — premise validation', () => {
  it('BREAKOUT: warns when price < entry but volMult < 2 (no selling pressure trigger)', () => {
    const result = interpretPositionState(BASE_POS, 5.60, { rsi: 54, volMult: 1.1, sma50Delta: 1 })
    expect(result).toMatch(/Wybicie zanegowane/)
  })

  it('BREAKOUT: positive when price > entry, volMult >= 2, RSI ok', () => {
    const result = interpretPositionState(BASE_POS, 6.00, { rsi: 65, volMult: 2.5, sma50Delta: 8 })
    expect(result).toMatch(/✅/)
    expect(result).toMatch(/trend kontynuowany/)
  })

  it('RSI_OVERSOLD: warns when RSI > 70', () => {
    const pos = { ...BASE_POS, signal: 'RSI_OVERSOLD' }
    const result = interpretPositionState(pos, 6.00, { rsi: 72, volMult: 1.5, sma50Delta: 5 })
    expect(result).toMatch(/RSI wykupiony/)
  })

  it('SMA50_CROSSOVER: warns when price fell below SMA50', () => {
    const pos = { ...BASE_POS, signal: 'SMA50_CROSSOVER' }
    const result = interpretPositionState(pos, 6.00, { rsi: 50, volMult: 1.2, sma50Delta: -2 })
    expect(result).toMatch(/wróciła pod SMA50/)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────

describe('interpretPositionState — edge cases', () => {
  it('returns null when cur is null', () => {
    expect(interpretPositionState(BASE_POS, 5.42, null)).toBeNull()
  })

  it('returns null when currentPrice is null', () => {
    expect(interpretPositionState(BASE_POS, null, GOOD_CUR)).toBeNull()
  })
})
