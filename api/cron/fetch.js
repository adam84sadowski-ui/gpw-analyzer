import { createClient } from '@vercel/kv'
import { fetchCandles, fetchFundamentals } from '../../src/lib/yahoo.js'
import { detectSignal } from '../../src/lib/signals.js'
import { interpretSignal } from '../../src/lib/interpretSignal.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'
import { UNIVERSES, allTickers } from '../../src/lib/universes.js'
import { fetchIndexTrend } from '../../src/lib/indextrend.js'
import { calcDynamicTarget, calcDynamicHorizon } from '../../src/lib/kvHistory.js'
import { fetchSeasonalityData, calculateMonthlyReturns } from '../../src/indicators/seasonality.js'
import { calcPositionSize, formatPositionSizingLine } from '../../src/indicators/positionSizing.js'
import { checkSectorExposure, formatSectorLine } from '../../src/indicators/sectorCorrelation.js'
import { getMacroEnvironment, formatMacroLine } from '../../src/indicators/macroFilter.js'
import { DIVIDEND_UNIVERSE, detectDividendSignal } from '../../src/strategies/dividend.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const SCORE_THRESHOLD = 60

const STRATEGY_CONFIG = {
  scalping: {
    label:     '⚡ Scalping',
    maxAlerts: 3,
    horizon:   '2-5 dni',
    describe:  s => `RSI = ${s.rsi?.toFixed(1)} (wyprzedany), wolumen ${s.volMult}x powyżej średniej. Potencjalne odbicie krótkoterminowe.`,
    kvExtra:   s => ({ rsi: s.rsi }),
  },
  swing: {
    label:     '📈 Swing',
    maxAlerts: 1,
    horizon:   '4-8 tyg.',
    describe:  s => `Cena przebiła SMA50 od dołu przy wolumenie ${s.volMult}x. Sygnał swing wzrostowy.`,
    kvExtra:   () => ({}),
  },
  aggressive: {
    label:     '🚀 Agresywna',
    maxAlerts: 2,
    horizon:   'brak (wysoki risk)',
    describe:  s => `Breakout powyżej max 20 dni, RSI ${s.rsi?.toFixed(1)}, wolumen ${s.volMult}x. ⚠️ WYSOKO RYZYKOWNA SPÓŁKA.`,
    kvExtra:   s => ({ rsi: s.rsi }),
  },
  recovery: {
    label:     '🔄 Odbicia',
    maxAlerts: 2,
    horizon:   '6-12 miesięcy',
    describe:  s => `Fallen angel: cena ${s.pctFrom52wHigh?.toFixed(1)}% od szczytu 52-tyg., RSI ${s.rsi?.toFixed(1)} (głęboko wyprzedana). Potencjał odbicia wartościowego.`,
    kvExtra:   s => ({ rsi: s.rsi, pctFrom52wHigh: s.pctFrom52wHigh }),
  },
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const { strategy, exchange = 'GPW' } = req.query

  // ── Dividend signal scan branch ────────────────────────────────────────
  if (strategy === 'dividend') {
    const now = new Date()
    if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

    const universe = DIVIDEND_UNIVERSE[exchange] ?? []
    const currency = exchange === 'NYSE' ? 'USD' : 'PLN'
    const settings = await kv.get(`${ENV}:settings`).catch(() => null)
    const portfolio = settings?.portfolio ?? 10000
    let sent = 0

    for (const ticker of universe) {
      try {
        let fund = await kv.get(`${ENV}:fundamentals:${exchange}:${ticker}`).catch(() => null)
        if (!fund) {
          fund = await fetchFundamentals(ticker, exchange).catch(() => null)
          if (fund) await kv.set(`${ENV}:fundamentals:${exchange}:${ticker}`, fund, { ex: 24 * 60 * 60 }).catch(() => {})
        }
        const sig = detectDividendSignal(ticker, fund)
        if (!sig) continue

        const dedupKey   = `${ENV}:div-signal:${ticker}:${now.toISOString().slice(0, 10)}`
        const alreadySent = await kv.get(dedupKey).catch(() => null)
        if (alreadySent) continue

        const label      = ticker.replace('.pl', '').toUpperCase()
        const name       = fund.shortName ?? label
        const posSize    = Math.round(portfolio * 0.15)
        const shares     = sig.price ? Math.floor(posSize / sig.price) : null
        const annualDiv  = shares && sig.price && fund.dividendYield
          ? Math.round(shares * sig.price * fund.dividendYield)
          : null

        const msg = [
          `📊 <b>SYGNAŁ DYWIDENDOWY: ${label}</b>`,
          name !== label ? name : '',
          '',
          `💰 Yield: <b>${sig.dividendYieldPct}%</b> | P/E: ${sig.pe ?? '—'} | Payout: ${sig.payoutRatioPct ?? '—'}%`,
          sig.exDividendDate ? `📅 Ex-dividend: ${sig.exDividendDate}` : '',
          '',
          `🎯 Strategia: kup i trzymaj 2–5 lat`,
          `💰 Portfel: ${portfolio.toLocaleString('pl-PL')} ${currency}`,
          `📌 Pozycja: ${posSize.toLocaleString('pl-PL')} ${currency}${shares ? ` (~${shares} akcji)` : ''}`,
          annualDiv ? `💵 Roczna dywidenda z pozycji: ~${annualDiv} ${currency}` : '',
          '',
          `⚠️ Analiza edukacyjna. Decyzja należy do Ciebie.`,
          `📱 <a href="https://gpw-analyzer.vercel.app">Otwórz aplikację</a>`,
        ].filter(l => l !== '').join('\n')

        await sendTelegram(msg, IS_STAGING)
        await kv.set(dedupKey, 1, { ex: 24 * 60 * 60 }).catch(() => {})
        sent++
      } catch (e) {
        console.error(`dividend scan error for ${ticker}:`, e.message)
      }
    }

    return res.json({ exchange, strategy: 'dividend', scanned: universe.length, sent })
  }

  // ── Seasonality pre-population branch ──────────────────────────────────
  if (strategy === 'seasonality') {
    const tickers = allTickers(exchange)
    const TTL = 30 * 24 * 60 * 60
    let saved = 0, failed = 0

    for (const ticker of tickers) {
      await new Promise(r => setTimeout(r, 200))
      try {
        const prices = await fetchSeasonalityData(ticker, exchange)
        if (!prices || prices.length < 60) { failed++; continue }
        const monthlyReturns = calculateMonthlyReturns(prices)
        await kv.set(`${ENV}:seasonality:${exchange}:${ticker}`, { monthlyReturns, updatedAt: new Date().toISOString() }, { ex: TTL })
        saved++
      } catch { failed++ }
    }

    return res.json({ exchange, total: tickers.length, saved, failed })
  }

  // ── Recovery warmup branch ──────────────────────────────────────────────
  // One-time cache pre-population: fetches 40 tickers/run, no scoring, no alerts.
  // Run 4× via GitHub Actions workflow_dispatch (strategy=recovery, slot=warmup)
  // to warm the full 162-ticker NYSE universe in ~20 minutes instead of 11 days.
  if (strategy === 'recovery' && req.query.slot === 'warmup') {
    const warmupUniverse = UNIVERSES[exchange]?.[strategy] ?? UNIVERSES.GPW[strategy]
    const WARMUP_TTL     = 48 * 60 * 60
    const WARMUP_BATCH   = 40

    const warmupChecks = await Promise.all(
      warmupUniverse.map(async ticker => ({
        ticker,
        cached: !!(await kv.get(`${ENV}:candles:${exchange}:${ticker}`).catch(() => null)),
      }))
    )
    const warmupMisses = warmupChecks.filter(c => !c.cached)
    const batch        = warmupMisses.slice(0, WARMUP_BATCH)

    const settled = await Promise.allSettled(batch.map(async ({ ticker }) => {
      const data = await Promise.race([
        fetchCandles(ticker, exchange),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ])
      if (data) {
        await kv.set(`${ENV}:candles:${exchange}:${ticker}`, data, { ex: WARMUP_TTL }).catch(() => {})
        return ticker
      }
      return null
    }))

    const warmed    = settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
    const remaining = Math.max(0, warmupMisses.length - WARMUP_BATCH)

    return res.json({
      mode:      'warmup',
      exchange,
      strategy,
      total:     warmupUniverse.length,
      cached:    warmupChecks.length - warmupMisses.length,
      warmed:    warmed.length,
      remaining,
      done:      remaining === 0,
      tickers:   warmed,
    })
  }

  // ── Signal detection branch ─────────────────────────────────────────────
  const config = STRATEGY_CONFIG[strategy]
  if (!config) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive|recovery|seasonality' })

  const now = new Date()
  if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

  const rawUniverse = UNIVERSES[exchange]?.[strategy] ?? UNIVERSES.GPW[strategy]
  const currency    = exchange === 'NYSE' ? 'USD' : 'PLN'

  const seasonalityKeys = rawUniverse.map(t => `${ENV}:seasonality:${exchange}:${t}`)
  const [rawThresholds, indexTrend, settings, positionKeys, macro, ...seasonalityValues] = await Promise.all([
    kv.get(`${ENV}:thresholds`).catch(() => null).then(v => v ?? {}),
    fetchIndexTrend(exchange).catch(() => 'neutral'),
    kv.get(`${ENV}:settings`).catch(() => null),
    kv.keys(`${ENV}:position:*`).catch(() => []),
    (async () => {
      const cached = await kv.get(`${ENV}:macro:${exchange}`).catch(() => null)
      if (cached) return cached
      const env = await getMacroEnvironment(exchange).catch(() => null)
      if (env) await kv.set(`${ENV}:macro:${exchange}`, env, { ex: 24 * 60 * 60 }).catch(() => {})
      return env
    })(),
    ...seasonalityKeys.map(k => kv.get(k).catch(() => null)),
  ])

  // Use per-exchange thresholds if available (new format), fall back to flat (old format)
  const thresholds = rawThresholds[exchange] ?? rawThresholds

  const universe = rawUniverse

  const seasonalityMap = {}
  rawUniverse.forEach((t, i) => {
    if (seasonalityValues[i]) seasonalityMap[t] = seasonalityValues[i].monthlyReturns
  })

  // Portfolio metrics
  const portfolio      = settings?.portfolio ?? 10000
  const maxPositionPct = settings?.maxPositionPct ?? 15

  const openPositions = positionKeys.length
    ? (await Promise.all(positionKeys.map(k => kv.get(k).catch(() => null)))).filter(p => p?.status === 'open')
    : []
  const totalInvested    = openPositions.reduce((sum, p) => sum + (p.positionSize ?? 0), 0)
  const totalExposurePct = portfolio > 0 ? totalInvested / portfolio * 100 : 0

  // ── Rate-limited candle fetching (Layer 1+2) ────────────────────────────
  // Check KV cache in parallel first; only call Yahoo on cache miss.
  // GPW: max 8 misses/run × 5s timeout = 40s worst case (under 55s curl limit).
  // NYSE: max 5 misses/run with 12s delay = ~56s safe within Vercel 60s limit.
  // Recovery: parallel batch of 15 misses/run, 4s timeout, 24h TTL (long-horizon strategy).
  const isRecovery  = strategy === 'recovery'
  const CANDLE_TTL  = isRecovery ? 48 * 60 * 60 : (exchange === 'NYSE' ? 90 * 60 : 25 * 60)
  const MISS_LIMIT  = exchange === 'NYSE' ? 5 : 8
  const MISS_DELAY  = 12000

  const cacheChecks = await Promise.all(
    universe.map(async ticker => ({
      ticker,
      data: await kv.get(`${ENV}:candles:${exchange}:${ticker}`).catch(() => null),
    }))
  )
  const cacheHits   = cacheChecks.filter(c => c.data !== null)
  const cacheMisses = cacheChecks.filter(c => c.data === null)

  const fetchedData = []

  if (isRecovery) {
    // Parallel batch: 15 misses per run, 4s timeout each — data persists 24h between daily cron runs.
    // 180 tickers ÷ 15/run = 12 daily cron runs to warm full cache (~2 weeks worst case).
    const batch = cacheMisses.slice(0, 15)
    const settled = await Promise.allSettled(batch.map(async ({ ticker }) => {
      const data = await Promise.race([
        fetchCandles(ticker, exchange),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ])
      if (data) {
        await kv.set(`${ENV}:candles:${exchange}:${ticker}`, data, { ex: CANDLE_TTL }).catch(() => {})
        return { ticker, data }
      }
      return null
    }))
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) fetchedData.push(r.value)
    }
  } else {
    for (let i = 0; i < Math.min(cacheMisses.length, MISS_LIMIT); i++) {
      if (i > 0 && exchange === 'NYSE') await new Promise(r => setTimeout(r, MISS_DELAY))
      const { ticker } = cacheMisses[i]
      try {
        const data = await Promise.race([
          fetchCandles(ticker, exchange),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ])
        if (data) {
          await kv.set(`${ENV}:candles:${exchange}:${ticker}`, data, { ex: CANDLE_TTL }).catch(() => {})
          fetchedData.push({ ticker, data })
        }
      } catch { /* skip this ticker this run */ }
    }
  }

  const allCandles = [...cacheHits, ...fetchedData]
  const signals = []
  for (const { ticker, data } of allCandles) {
    const candles = data?.candles
    if (!candles || candles.length < 25) continue
    const sig = detectSignal(candles, strategy, thresholds, exchange, indexTrend, seasonalityMap[ticker])
    const scoreThreshold = strategy === 'recovery' ? 30 : SCORE_THRESHOLD
    if (sig && sig.score >= scoreThreshold) signals.push({ ...sig, ticker })
  }
  signals.sort((a, b) => b.score - a.score)

  const skipDate = now.toISOString().slice(0, 10)
  async function logSkip(ticker, reason, score, adjustedScore) {
    await kv.set(`${ENV}:skip:${strategy}:${ticker}:${skipDate}`,
      { reason, score, adjustedScore, strategy, exchange, timestamp: now.toISOString() },
      { ex: 48 * 60 * 60 }
    ).catch(() => {})
  }

  // Log signals beyond maxAlerts
  for (const signal of signals.slice(config.maxAlerts)) {
    await logSkip(signal.ticker, 'max_alerts', signal.score, signal.score)
  }

  // Weekly dedup key for recovery: prevent repeat alerts for same ticker within 7 days
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)) // Monday of current week
  const weekKey = weekStart.toISOString().slice(0, 10)

  let sent = 0
  for (const signal of signals.slice(0, config.maxAlerts)) {
    // Recovery: skip if already alerted this week (7-day dedup per ticker)
    if (strategy === 'recovery') {
      const dedupKey = `${ENV}:dedup:recovery:${signal.ticker}:${weekKey}`
      const alreadySent = await kv.get(dedupKey).catch(() => null)
      if (alreadySent) { await logSkip(signal.ticker, 'weekly_dedup', signal.score, signal.score); continue }
    }

    // Macro score adjustment
    const macroAdj      = macro?.scoreAdjustment ?? 0
    const adjustedScore = signal.score + macroAdj
    if (adjustedScore < SCORE_THRESHOLD) { await logSkip(signal.ticker, 'macro', signal.score, adjustedScore); continue }

    // Sector exposure check
    const sectorCheck = checkSectorExposure(signal.ticker, exchange, openPositions)
    if (sectorCheck.block) { await logSkip(signal.ticker, 'sector', signal.score, adjustedScore); continue }

    // Dynamic position sizing
    const effectiveMaxPct = sectorCheck.reduce ? maxPositionPct * 0.5 : maxPositionPct
    const posResult       = calcPositionSize(portfolio, effectiveMaxPct, adjustedScore, 0, totalExposurePct)
    if (posResult.blocked) { await logSkip(signal.ticker, 'position_size', signal.score, adjustedScore); continue }

    const positionSize = posResult.size
    const shares       = positionSize > 0 && signal.price > 0 ? Math.floor(positionSize / signal.price) : 0

    const alertId = `${ENV}:alert:${strategy}:${signal.ticker}:${Date.now()}`

    const defaultTarget = signal.signal === 'RSI_OVERSOLD' ? 5 : signal.signal === 'VOL_SURGE' ? 3 : signal.signal === 'SMA50_CROSSOVER' ? 15 : 35
    const defaultStop   = signal.signal === 'RSI_OVERSOLD' ? 3 : signal.signal === 'VOL_SURGE' ? 2 : signal.signal === 'SMA50_CROSSOVER' ? 5  : 8
    const stopLoss      = signal.dynamicStopLoss ?? defaultStop

    const [dynTarget, dynHorizon] = await Promise.all([
      calcDynamicTarget(kv, signal.ticker, strategy, ENV),
      calcDynamicHorizon(kv, signal.ticker, strategy, ENV),
    ])
    const target  = dynTarget.target
    const horizon = dynHorizon.horizon
    const interp  = interpretSignal(
      signal.signal,
      { rsi: signal.rsi, volMult: signal.volMult, price: signal.price, sma20: signal.sma20, sma50: signal.sma50 },
      strategy,
    )

    const indexLine = indexTrend === 'up'
      ? `📈 Indeks: trend wzrostowy`
      : indexTrend === 'down'
        ? `⚠️ Indeks: trend spadkowy`
        : `➡️ Indeks: neutralny`

    const supportLine = signal.nearSupport
      ? `🔵 Blisko wsparcia: ${signal.nearSupport}`
      : ''

    const sma150Line = signal.sma150Warning
      ? `⚠️ SMA150: cena poniżej długoterminowego trendu — podwyższone ryzyko`
      : signal.sma150trend === 'above'
        ? `✅ SMA150: cena powyżej (trend wzrostowy)`
        : ''

    const macroLine  = formatMacroLine(macro, exchange)
    const sectorLine = formatSectorLine(sectorCheck)
    const posLine    = formatPositionSizingLine(posResult, signal.price, currency)

    const extraLines = [indexLine, supportLine, sma150Line, macroLine, sectorLine].filter(Boolean).join('\n')

    const msg = formatAlert({
      ticker:         signal.ticker.replace('.pl', '').toUpperCase(),
      strategy:       config.label,
      price:          signal.price,
      signal:         signal.signal,
      target,
      stopLoss,
      portfolio,
      positionSize,
      shares,
      description:    `${config.describe(signal)}\n${extraLines}\n🎯 Score: ${adjustedScore}/100${macroAdj !== 0 ? ` (${signal.score}${macroAdj > 0 ? '+' : ''}${macroAdj} makro)` : ''}${signal.dynamicStopLoss ? ` | 🛑 Stop ATR: ${signal.dynamicStopLoss}%` : ''}\n🎯 Cel: ${target}% ${dynTarget.source === 'historical' ? `(hist. ${dynTarget.samples} sygn.)` : '(domyślny)'}\n${posLine}`,
      exchange,
      currency,
      companyName:    null,
      horizon:        `${horizon}${dynHorizon.source === 'historical' ? ` (hist. ${dynHorizon.samples} sygn.)` : ''}`,
      interpretation: interp,
    })

    // AI Swap suggestion — strong new signal (≥70) while a weak open position exists on same exchange
    let swapLine = ''
    if (adjustedScore >= 70) {
      const swapCandidate = openPositions.find(p =>
        (p.exchange ?? 'GPW') === exchange &&
        p.aiEvalHistory?.length > 0 &&
        p.aiEvalHistory[p.aiEvalHistory.length - 1].holdTotal < 35
      )
      if (swapCandidate) {
        const swapTicker = swapCandidate.tickerDisplay ?? swapCandidate.ticker.replace('.pl', '').toUpperCase()
        const swapHS = swapCandidate.aiEvalHistory[swapCandidate.aiEvalHistory.length - 1].holdTotal
        swapLine = `\n\n🔄 <b>AI SWAP:</b> Rozważ zamknięcie <b>${swapTicker}</b> (Hold Strength: ${swapHS}/100) i otwarcie tej pozycji.`
      }
    }
    await sendTelegram(msg + swapLine, IS_STAGING)

    await kv.set(alertId, {
      id: alertId, ticker: signal.ticker, strategy, exchange,
      signal: signal.signal, price: signal.price,
      score: adjustedScore, indexTrend,
      timestamp: now.toISOString(), targetAchieved: null,
      thresholdsAtSignal: thresholds,
      positionSize, shares,
      ...config.kvExtra(signal),
    }, { ex: 365 * 24 * 60 * 60 })

    // Store weekly dedup for recovery to prevent repeat alerts same week
    if (strategy === 'recovery') {
      const dedupKey = `${ENV}:dedup:recovery:${signal.ticker}:${weekKey}`
      await kv.set(dedupKey, 1, { ex: 8 * 24 * 60 * 60 }).catch(() => {})
    }

    sent++
  }

  res.json({ signals: signals.length, sent, exchange, strategy, indexTrend })
}
