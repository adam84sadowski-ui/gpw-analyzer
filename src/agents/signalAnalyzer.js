import { fetchIndex, fetchDaily } from '../services/stooq.js'
import { scalpingSignal, SCALPING_DEFAULTS } from '../strategies/scalping.js'
import { swingSignal, SWING_DEFAULTS } from '../strategies/swing.js'
import { aggressiveSignal, AGGRESSIVE_DEFAULTS } from '../strategies/aggressive.js'

const INDEX_MAP = {
  scalping:   'wig20.pl',
  swing:      'mwig40.pl',
  aggressive: 'swig80.pl',
}

const STRATEGY_FN = {
  scalping:   scalpingSignal,
  swing:      swingSignal,
  aggressive: aggressiveSignal,
}

const UNIVERSE_MAP = {
  scalping:   SCALPING_DEFAULTS.universe,
  swing:      SWING_DEFAULTS.universe,
  aggressive: AGGRESSIVE_DEFAULTS.universe,
}

export async function analyzeStrategy(strategyName, thresholds = {}) {
  const indexTicker = INDEX_MAP[strategyName]
  if (!indexTicker) throw new Error(`Unknown strategy: ${strategyName}`)

  // Step 1: check index first (1 API call)
  const indexData = await fetchIndex(indexTicker)
  if (!indexData) return []

  // Basic index signal: if close > open the market has some strength
  const indexClose = indexData.close ?? parseFloat(indexData.Close)
  const indexOpen  = indexData.open  ?? parseFloat(indexData.Open)
  const indexBull  = indexClose >= indexOpen * 0.995 // within 0.5% of open

  if (!indexBull && strategyName !== 'swing') {
    console.log(`[${strategyName}] Index bearish — skipping stock scan`)
    return []
  }

  // Step 2: scan stocks
  const universe = UNIVERSE_MAP[strategyName]
  const strategyFn = STRATEGY_FN[strategyName]
  const signals = []

  for (const ticker of universe) {
    try {
      const candles = await fetchDaily(ticker)
      if (!candles || candles.length < 20) continue
      const signal = strategyFn(candles, thresholds)
      if (signal) signals.push({ ...signal, ticker })
    } catch (e) {
      console.error(`Error scanning ${ticker}:`, e.message)
    }
  }

  return signals
}
