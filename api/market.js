import { createClient } from '@vercel/kv'
import { fetchCandles, fetchCurrent, fetchCandlesExtended, fetchFundamentals } from '../src/lib/yahoo.js'
import { detectSignal, calcIndicators, SIGNAL_DEFAULTS } from '../src/lib/signals.js'
import { calcRSI } from '../src/indicators/rsi.js'
import { volumeMultiplier } from '../src/indicators/volume.js'
import { calcSMA } from '../src/indicators/sma.js'
import { UNIVERSES } from '../src/lib/universes.js'
import { fetchIndexTrend } from '../src/lib/indextrend.js'
import { calcDynamicTarget, calcDynamicHorizon } from '../src/lib/kvHistory.js'
import { getMacroEnvironment } from '../src/indicators/macroFilter.js'
import { runSimulation, calcMetrics } from '../src/lib/backtester.js'
import { runGEMAlgorithm, simulateGEM } from '../src/strategies/gem.js'

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
    await kv.set(kvKey, data, { ex: exchange === 'NYSE' ? 90 * 60 : 25 * 60 }).catch(() => {})
  }
  return data  // { candles, shortName }
}

export default async function handler(req, res) {
  const { mode = 'daily', ticker, strategy, exchange = 'GPW' } = req.query

  // ── ETF purchase modes (GET + POST) ──────────────────────────────────
  if (mode === 'etf-list') {
    const data = await kv.get(`${ENV}:etf:purchases`).catch(() => null)
    return res.json(Array.isArray(data) ? data : [])
  }

  if (mode === 'etf-add') {
    if (req.method !== 'POST') return res.status(405).end()
    const { ticker: t, date, price, units } = req.body ?? {}
    if (!t || !price || !units) return res.status(400).json({ error: 'ticker, price, units required' })
    const existing = await kv.get(`${ENV}:etf:purchases`).catch(() => null) ?? []
    const entry = { id: `${t}-${Date.now()}`, ticker: t, date: date ?? new Date().toISOString().slice(0, 10), price: Number(price), units: Number(units), addedAt: new Date().toISOString() }
    await kv.set(`${ENV}:etf:purchases`, [...existing, entry])
    return res.json(entry)
  }

  if (mode === 'etf-delete') {
    if (req.method !== 'POST') return res.status(405).end()
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id required' })
    const existing = await kv.get(`${ENV}:etf:purchases`).catch(() => null) ?? []
    await kv.set(`${ENV}:etf:purchases`, existing.filter(p => p.id !== id))
    return res.json({ deleted: id })
  }

  if (mode === 'gem-portfolio') {
    if (req.method === 'POST') {
      const body = req.body ?? {}
      await kv.set(`${ENV}:gem:portfolio`, body)
      return res.json({ ok: true })
    }
    const portfolio = await kv.get(`${ENV}:gem:portfolio`).catch(() => null)
    return res.json(portfolio ?? {})
  }

  if (req.method !== 'GET') return res.status(405).end()

  if (!['GPW', 'NYSE', 'ETF'].includes(exchange)) {
    return res.status(400).json({ error: 'exchange must be GPW|NYSE|ETF' })
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

  // ── Fundamentals mode ────────────────────────────────────────────────
  if (mode === 'fundamentals') {
    if (!ticker) return res.status(400).json({ error: 'ticker required' })
    const cacheKey = `${ENV}:fundamentals:${exchange}:${ticker}`
    const cached   = await kv.get(cacheKey).catch(() => null)
    if (cached) return res.json(cached)
    const data = await fetchFundamentals(ticker, exchange).catch(() => null)
    if (!data) return res.status(404).json({ error: 'no fundamentals data' })
    await kv.set(cacheKey, data, { ex: 24 * 60 * 60 }).catch(() => {})
    return res.json(data)
  }

  // ── GEM modes ────────────────────────────────────────────────────────
  if (mode === 'gem-decision') {
    let result = await kv.get(`${ENV}:gem:latest`).catch(() => null)
    if (!result) {
      // Run on-demand if no cached result yet
      const [cspxData, swrdData, macro] = await Promise.allSettled([
        fetchCandlesExtended('cspx', 'ETF', '1y'),
        fetchCandlesExtended('swrd', 'ETF', '1y'),
        getMacroEnvironment('GPW'),
      ]).then(r => r.map(s => s.status === 'fulfilled' ? s.value : null))
      const cashRate = ((macro?.fedRate ?? 5.75) / 100)
      const gemConfig = await kv.get(`${ENV}:gem:config`).catch(() => null)
      const lookback  = gemConfig?.lookback ?? 12
      result = runGEMAlgorithm(cspxData?.candles, swrdData?.candles, cashRate, lookback)
      if (result) await kv.set(`${ENV}:gem:latest`, result, { ex: 35 * 24 * 60 * 60 }).catch(() => {})
    }
    if (!result) return res.status(503).json({ error: 'GEM data unavailable' })
    return res.json(result)
  }

  if (mode === 'gem-history') {
    const history = await kv.get(`${ENV}:gem:history`).catch(() => null)
    return res.json(Array.isArray(history) ? history : [])
  }

  if (mode === 'gem-simulate') {
    const cacheKey = `${ENV}:gem:simulate`
    const cached   = await kv.get(cacheKey).catch(() => null)
    if (cached) return res.json(cached)
    const [cspxData, swrdData, agghData, vwceData, macro] = await Promise.allSettled([
      fetchCandlesExtended('cspx', 'ETF', '5y'),
      fetchCandlesExtended('swrd', 'ETF', '5y'),
      fetchCandlesExtended('aggh', 'ETF', '5y'),
      fetchCandlesExtended('vwce', 'ETF', '5y'),
      getMacroEnvironment('GPW'),
    ]).then(r => r.map(s => s.status === 'fulfilled' ? s.value : null))
    if (!cspxData?.candles || !vwceData?.candles) {
      return res.status(503).json({ error: 'Insufficient ETF data for simulation' })
    }
    const cashRate = ((macro?.fedRate ?? 5.75) / 100)
    const result   = simulateGEM(
      cspxData.candles, swrdData?.candles ?? [], agghData?.candles ?? [], vwceData.candles,
      { cashRate }
    )
    if (!result) return res.status(503).json({ error: 'Simulation failed' })
    await kv.set(cacheKey, result, { ex: 7 * 24 * 60 * 60 }).catch(() => {})
    return res.json(result)
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

  // ── Indicators mode ──────────────────────────────────────────────────
  if (mode === 'indicators') {
    if (!ticker) return res.status(400).json({ error: 'ticker required' })
    const data    = await getCachedData(ticker, exchange)
    const candles = data?.candles
    if (!candles || candles.length < 25) return res.status(404).json({ error: 'no data' })
    const closes    = candles.map(c => c.close)
    const volumes   = candles.map(c => c.volume)
    const price     = closes[closes.length - 1]
    const defaults  = SIGNAL_DEFAULTS[exchange] ?? SIGNAL_DEFAULTS.GPW
    const rsiPeriod = defaults[strategy]?.rsiPeriod ?? 14
    const sma50      = calcSMA(closes, 50)
    const sma150     = calcSMA(closes, 150)
    const sma150trend = sma150 != null ? (price > sma150 ? 'above' : 'below') : null
    return res.json({
      price,
      rsi:         calcRSI(closes, rsiPeriod),
      rsiPeriod,
      volMult:     Math.round((volumeMultiplier(volumes) ?? 0) * 10) / 10,
      sma50Delta:  sma50 ? Math.round((price - sma50) / sma50 * 10000) / 100 : null,
      sma150trend,
    })
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
