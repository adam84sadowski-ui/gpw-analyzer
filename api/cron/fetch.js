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

  // ── Signal detection branch ─────────────────────────────────────────────
  const config = STRATEGY_CONFIG[strategy]
  if (!config) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive|seasonality' })

  const now = new Date()
  if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

  const universe = UNIVERSES[exchange]?.[strategy] ?? UNIVERSES.GPW[strategy]
  const currency = exchange === 'NYSE' ? 'USD' : 'PLN'

  const seasonalityKeys = universe.map(t => `${ENV}:seasonality:${exchange}:${t}`)
  const [thresholds, indexTrend, settings, positionKeys, macro, ...seasonalityValues] = await Promise.all([
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

  const seasonalityMap = {}
  universe.forEach((t, i) => {
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

  const settled = await Promise.allSettled(
    universe.map(async ticker => {
      const data = await Promise.race([
        fetchCandles(ticker, exchange),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 7000)),
      ])
      const candles = data?.candles
      if (!candles || candles.length < 25) return null
      const sig = detectSignal(candles, strategy, thresholds, exchange, indexTrend, seasonalityMap[ticker])
      return sig ? { ...sig, ticker } : null
    })
  )

  const signals = settled
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .filter(s => s.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)

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

  let sent = 0
  for (const signal of signals.slice(0, config.maxAlerts)) {
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

    const defaultTarget = signal.signal === 'RSI_OVERSOLD' ? 5 : signal.signal === 'SMA50_CROSSOVER' ? 15 : 35
    const defaultStop   = signal.signal === 'RSI_OVERSOLD' ? 3 : signal.signal === 'SMA50_CROSSOVER' ? 5  : 8
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

    await sendTelegram(msg, IS_STAGING)

    await kv.set(alertId, {
      id: alertId, ticker: signal.ticker, strategy, exchange,
      signal: signal.signal, price: signal.price,
      score: adjustedScore, indexTrend,
      timestamp: now.toISOString(), targetAchieved: null,
      thresholdsAtSignal: thresholds,
      positionSize, shares,
      ...config.kvExtra(signal),
    }, { ex: 365 * 24 * 60 * 60 })

    sent++
  }

  res.json({ signals: signals.length, sent, exchange, strategy, indexTrend })
}
