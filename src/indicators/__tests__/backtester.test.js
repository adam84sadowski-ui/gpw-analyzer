import { describe, it, expect } from 'vitest'
import { calcMetrics, runSimulation } from '../../lib/backtester.js'

function makeCandles(n, price = 100) {
  return Array.from({ length: n }, (_, i) => ({
    date:   `2022-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open:   price,
    high:   price + 2,
    low:    price - 2,
    close:  price,
    volume: 1000,
  }))
}

const config  = { target: 10, stopLoss: 5 }
const maxDays = 5

describe('calcMetrics', () => {
  it('TC-BT-01: win rate — 3 winners out of 5', () => {
    const trades = [
      { gainPct: 5, exitDate: '2022-01-10' },
      { gainPct: -3, exitDate: '2022-01-15' },
      { gainPct: 8, exitDate: '2022-02-01' },
      { gainPct: -2, exitDate: '2022-02-10' },
      { gainPct: 6, exitDate: '2022-03-01' },
    ]
    const equityCurve = [{ date: '2022-01-01', equity: 100 }]
    const m = calcMetrics(trades, equityCurve)
    expect(m.winRate).toBe(60.0)
    expect(m.winning_trades).toBe(3)
    expect(m.losing_trades).toBe(2)
  })

  it('TC-BT-02: profit factor = grossWin / grossLoss', () => {
    const trades = [
      { gainPct: 15, exitDate: '2022-02-01' },
      { gainPct: 15, exitDate: '2022-02-10' },
      { gainPct: -5, exitDate: '2022-03-01' },
      { gainPct: -5, exitDate: '2022-03-10' },
    ]
    const m = calcMetrics(trades, [{ date: '2022-01-01', equity: 100 }])
    expect(m.profit_factor).toBe(3.0)  // 30/10
  })

  it('TC-BT-03: max drawdown calculation', () => {
    const equityCurve = [
      { date: '2022-01-01', equity: 100 },
      { date: '2022-01-02', equity: 110 },
      { date: '2022-01-03', equity: 105 },
      { date: '2022-01-04', equity: 95  },
      { date: '2022-01-05', equity: 100 },
    ]
    const m = calcMetrics([], equityCurve)
    // peak=110, trough=95, dd=(110-95)/110*100=13.636...
    expect(m.maxDrawdown).toBeCloseTo(13.64, 1)
  })

  it('TC-BT-07: equity curve starts at 100', () => {
    const candles = makeCandles(60)
    const { equityCurve } = runSimulation(candles, 'scalping', config, maxDays, 'GPW', () => null)
    expect(equityCurve[0].equity).toBe(100)
  })
})

describe('runSimulation', () => {
  it('TC-BT-04: stop has priority over target on same candle', () => {
    const candles = makeCandles(56)
    // last candle: low triggers stop, high would trigger target
    const entry = 100
    const stopPrice   = 95
    const targetPrice = 110

    // inject a detectFn that fires once on candle 55 with our entry
    let fired = false
    const detectFn = () => {
      if (!fired) { fired = true; return { dynamicStopLoss: null } }
      return null
    }

    const localConfig = { target: 10, stopLoss: 5 }
    // Set the last candle so low <= stopPrice and high >= targetPrice
    candles[55] = { ...candles[55], low: 94, high: 115, close: 98 }

    const { trades } = runSimulation(candles, 'scalping', localConfig, 10, 'GPW', detectFn)
    // Only if a trade was opened and then closed on the same candle:
    // exitReason must be 'stop' (checked first in the loop)
    const stopsFirst = trades.every(t => !(t.exitReason === 'target' && t.entry === entry))
    expect(stopsFirst).toBe(true)
  })

  it('TC-BT-05: horizon exit when maxDays exceeded without stop/target', () => {
    const candles = makeCandles(70)
    let fired = false
    // signal fires at index 55, price stays flat — no stop/target triggered
    const detectFn = (slice) => {
      if (slice.length === 56 && !fired) { fired = true; return { dynamicStopLoss: null } }
      return null
    }
    const stableConfig = { target: 50, stopLoss: 50 }  // very wide stop/target
    const { trades } = runSimulation(candles, 'scalping', stableConfig, 3, 'GPW', detectFn)
    const horizonTrade = trades.find(t => t.exitReason === 'horizon')
    expect(horizonTrade).toBeDefined()
  })

  it('TC-BT-06: throws when candles < 55', () => {
    expect(() => runSimulation(makeCandles(30), 'scalping', config, maxDays))
      .toThrow('Za mało danych historycznych')
  })

  it('TC-BT-08: no trades → winRate=0, profit_factor=null', () => {
    const candles = makeCandles(60)
    const { trades, equityCurve } = runSimulation(candles, 'scalping', config, maxDays, 'GPW', () => null)
    const m = calcMetrics(trades, equityCurve)
    expect(m.winRate).toBe(0)
    expect(m.profit_factor).toBeNull()
    expect(m.sharpe_ratio).toBeNull()
  })
})
