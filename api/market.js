import { createClient } from '@vercel/kv'
import { fetchCandles, fetchCurrent, fetchCandlesExtended } from '../src/lib/yahoo.js'
import { detectSignal, calcIndicators } from '../src/lib/signals.js'
import { UNIVERSES } from '../src/lib/universes.js'
import { fetchIndexTrend } from '../src/lib/indextrend.js'
import { calcDynamicTarget, calcDynamicHorizon } from '../src/lib/kvHistory.js'
import { getMacroEnvironment } from '../src/indicators/macroFilter.js'
import { runSimulation, calcMetrics } from '../src/lib/backtester.js'

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const MEM_CACHE_TTL = 25 * 60 * 1000
const memCache = new Map()

function memGet(key) {
  const hit = memCache.get(key)
  return hit && Date.now() - hit.ts < MEM_CACHE_TTL ? hit.data : null
}
function memSet(key, data) { memCache.set(key, { data, ts: Date.now() }) }


const STRATEGY_CONFIG = {
  scalping:   { target: 5,  stopLoss: 3,  label: '⚡ Scalping' },
  swing:      { target: 15, stopLoss: 5,  label: '📈 Swing' },
  aggressive: { target: 35, stopLoss: 8,  label: '🚀 Agresywna' },
}

function tickerDisplay(ticker, exchange) {
  if (exchange === 'NYSE') return ticker.toUpperCase()
  return ticker.replace('.pl', '').toUpperCase()
}

async function fetchWithTimeout(fn, ms = 5000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function getCachedData(ticker, exchange) {
  const kvKey = `${ENV}:candles:${exchange}:${ticker}`
  const memKey = `candles:${exchange}:${ticker}`
  const fromMem = memGet(memKey)
  if (fromMem) return fromMem
  const fromKv = await kv.get(kvKey).catch(() => null)
  if (fromKv) { memSet(memKey, fromKv); return fromKv }
  const data = await fetchWithTimeout(() => fetchCandles(ticker, exchange))
  if (data) {
    memSet(memKey, data)
    await kv.set(kvKey, data, { ex: 25 * 60 }).catch(() => {})
  }
  return data  // { candles, shortName }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { mode = 'daily', ticker, strategy, exchange = 'GPW' } = req.query

  if (!['GPW', 'NYSE'].includes(exchange)) {
    return res.status(400).json({ error: 'exchange must be GPW or NYSE' })
  }

  // ── Single ticker modes ──────────────────────────────────────────────
  if (mode === 'daily') {
    if (!ticker) return res.status(400).json({ error: 'ticker required' })
    const cacheKey = `daily:${exchange}:${ticker}`
    const cached = memGet(cacheKey)
    if (cached) return res.json(cached)
    const data = await fetchCandles(ticker, exchange)
    if (!data) return res.status(404).json({ error: 'no data' })
    memSet(cacheKey, data.candles)
    return res.json(data.candles)
  }

  if (mode === 'current' || mode === 'index') {
    if (!ticker) return res.status(400).json({ error: 'ticker required' })
    const cacheKey = `current:${exchange}:${ticker}`
    const cached = memGet(cacheKey)
    if (cached) return res.json(cached)
    let data = await fetchCurrent(ticker, exchange).catch(() => null)
    if (!data?.close) {
      const candleData = await fetchCandles(ticker, exchange).catch(() => null)
      const candles = candleData?.candles
      if (candles?.length) {
        const last = candles[candles.length - 1]
        data = { close: last.close, open: last.open, high: last.high, low: last.low,
          volume: last.volume, date: last.date,
          Close: String(last.close), Open: String(last.open),
          shortName: candleData.shortName ?? null }
      }
    }
    if (!data?.close) return res.status(404).json({ error: 'no data' })
    memSet(cacheKey, data)
    return res.json(data)
  }

  // ── Backtest mode ────────────────────────────────────────────────────
  if (mode === 'backtest') {
    if (!ticker)   return res.status(400).json({ error: 'ticker required' })
    if (!strategy || !STRATEGY_CONFIG[strategy]) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })

    const cacheKey = `${ENV}:backtest:${exchange}:${ticker}:${strategy}`
    const cached   = await kv.get(cacheKey).catch(() => null)
    if (cached) return res.json(cached)

    const config  = STRATEGY_CONFIG[strategy]
    const maxDays = { scalping: 5, swing: 40, aggressive: 30 }[strategy]

    const data    = await fetchWithTimeout(() => fetchCandlesExtended(ticker, exchange, '5y'), 10000).catch(() => null)
    const candles = data?.candles
    if (!candles || candles.length < 55) return res.status(404).json({ error: 'Za mało danych historycznych' })

    const { trades, equityCurve } = runSimulation(candles, strategy, config, maxDays, exchange)
    const metrics = calcMetrics(trades, equityCurve)

    const result = {
      ticker, strategy, exchange,
      candles: candles.length,
      period:  `${candles[0].date} → ${candles[candles.length - 1].date}`,
      trades,
      ...metrics,
      equityCurve,
      generatedAt: new Date().toISOString(),
    }

    await kv.set(cacheKey, result, { ex: 30 * 24 * 60 * 60 }).catch(() => {})
    return res.json(result)
  }

  // ── Macro mode ───────────────────────────────────────────────────────
  if (mode === 'macro') {
    const memKey = `macro:${exchange}`
    const fromMem = memGet(memKey)
    if (fromMem) return res.json(fromMem)
    const kvKey = `${ENV}:macro:${exchange}`
    let macro = await kv.get(kvKey).catch(() => null)
    if (!macro) {
      macro = await getMacroEnvironment(exchange).catch(() => null)
      if (macro) await kv.set(kvKey, macro, { ex: 24 * 60 * 60 }).catch(() => {})
    }
    if (!macro) return res.status(503).json({ error: 'macro unavailable' })
    memSet(memKey, macro)
    return res.json(macro)
  }

  // ── Strategy modes ───────────────────────────────────────────────────
  if (mode !== 'signals' && mode !== 'scan') {
    return res.status(400).json({ error: 'mode must be daily|current|index|macro|backtest|signals|scan' })
  }

  if (!strategy || !STRATEGY_CONFIG[strategy]) {
    return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })
  }

  const universe = UNIVERSES[exchange]?.[strategy]
  if (!universe) return res.status(400).json({ error: 'unsupported exchange/strategy' })

  const cacheKey = `${mode}:${exchange}:${strategy}`
  const cached = memGet(cacheKey)
  if (cached) return res.json(cached)

  const seasonalityKeys = universe.map(t => `${ENV}:seasonality:${exchange}:${t}`)
  const [thresholds, indexTrend, ...seasonalityValues] = await Promise.all([
    kv.get(`${ENV}:thresholds`).catch(() => null).then(v => v ?? {}),
    fetchIndexTrend(exchange).catch(() => 'neutral'),
    ...seasonalityKeys.map(k => kv.get(k).catch(() => null)),
  ])
  const seasonalityMap = {}
  universe.forEach((t, i) => {
    if (seasonalityValues[i]) seasonalityMap[t] = seasonalityValues[i].monthlyReturns
  })

  const config = STRATEGY_CONFIG[strategy]
  const results = []

  // Batch fetch: groups of 10 in parallel
  const batchSize = 10
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize)
    const settled = await Promise.allSettled(
      batch.map(async t => {
        const data = await getCachedData(t, exchange)
        const candles = data?.candles
        if (!candles || candles.length < 25) return null
        const display = tickerDisplay(t, exchange)
        const companyName = data?.shortName ?? null
        if (mode === 'scan') {
          const ind = calcIndicators(candles, strategy, thresholds, exchange, indexTrend, seasonalityMap[t])
          if (!ind) return null
          return { ticker: t, tickerDisplay: display, companyName, exchange, strategy,
            target: config.target, stopLoss: config.stopLoss,
            timestamp: new Date().toISOString(), ...ind }
        } else {
          const sig = detectSignal(candles, strategy, thresholds, exchange, indexTrend, seasonalityMap[t])
          if (!sig) return null
          const [dynTarget, dynHorizon] = await Promise.all([
            calcDynamicTarget(kv, t, strategy, ENV),
            calcDynamicHorizon(kv, t, strategy, ENV),
          ])
          const stopLoss = sig.dynamicStopLoss ?? config.stopLoss
          return { ticker: t, tickerDisplay: display, companyName, exchange, strategy,
            label: config.label,
            target: dynTarget.target, targetSource: dynTarget.source, targetSamples: dynTarget.samples,
            horizon: dynHorizon.horizon, horizonSource: dynHorizon.source,
            stopLoss,
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            ...sig }
        }
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    }
  }

  if (mode === 'scan') results.sort((a, b) => {
    if (b.hasSignal !== a.hasSignal) return (b.hasSignal ? 1 : 0) - (a.hasSignal ? 1 : 0)
    return (b.score ?? 0) - (a.score ?? 0)
  })

  memSet(cacheKey, results)
  res.json(results)
}
