import { createClient } from '@vercel/kv'
import { fetchCandles } from '../../src/lib/yahoo.js'
import { detectSignal } from '../../src/lib/signals.js'
import { interpretSignal } from '../../src/lib/interpretSignal.js'
import { sendTelegram, formatAlert } from '../../src/services/telegram.js'
import { UNIVERSES } from '../../src/lib/universes.js'
import { fetchIndexTrend } from '../../src/lib/indextrend.js'
import { calcDynamicTarget, calcDynamicHorizon } from '../../src/lib/kvHistory.js'

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
  const config = STRATEGY_CONFIG[strategy]
  if (!config) return res.status(400).json({ error: 'strategy must be scalping|swing|aggressive' })

  const now = new Date()
  if (now.getDay() === 0 || now.getDay() === 6) return res.json({ skipped: 'weekend' })

  const [thresholds, indexTrend] = await Promise.all([
    kv.get(`${ENV}:thresholds`).catch(() => null).then(v => v ?? {}),
    fetchIndexTrend(exchange).catch(() => 'neutral'),
  ])

  const universe = UNIVERSES[exchange]?.[strategy] ?? UNIVERSES.GPW[strategy]

  const settled = await Promise.allSettled(
    universe.map(async ticker => {
      const data = await Promise.race([
        fetchCandles(ticker, exchange),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 7000)),
      ])
      const candles = data?.candles
      if (!candles || candles.length < 25) return null
      const sig = detectSignal(candles, strategy, thresholds, exchange, indexTrend)
      return sig ? { ...sig, ticker } : null
    })
  )

  const signals = settled
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .filter(s => s.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  let sent = 0
  for (const signal of signals.slice(0, config.maxAlerts)) {
    const alertId = `${ENV}:alert:${strategy}:${signal.ticker}:${Date.now()}`
    const portfolio    = 10000
    const positionSize = Math.round(portfolio * 0.15)

    const defaultTarget = signal.signal === 'RSI_OVERSOLD' ? 5 : signal.signal === 'SMA50_CROSSOVER' ? 15 : 35
    const defaultStop   = signal.signal === 'RSI_OVERSOLD' ? 3 : signal.signal === 'SMA50_CROSSOVER' ? 5  : 8
    const stopLoss      = signal.dynamicStopLoss ?? defaultStop

    const [dynTarget, dynHorizon] = await Promise.all([
      calcDynamicTarget(kv, signal.ticker, strategy, ENV),
      calcDynamicHorizon(kv, signal.ticker, strategy, ENV),
    ])
    const target  = dynTarget.target
    const horizon = dynHorizon.horizon
    const interp   = interpretSignal(
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

    const extraLines = [indexLine, supportLine, sma150Line].filter(Boolean).join('\n')

    const msg = formatAlert({
      ticker:         signal.ticker.replace('.pl', '').toUpperCase(),
      strategy:       config.label,
      price:          signal.price,
      signal:         signal.signal,
      target,
      stopLoss,
      portfolio,
      positionSize,
      shares:         Math.floor(positionSize / signal.price),
      description:    `${config.describe(signal)}\n${extraLines}\n🎯 Score: ${signal.score}/100${signal.dynamicStopLoss ? ` | 🛑 Stop ATR: ${signal.dynamicStopLoss}%` : ''}\n🎯 Cel: ${target}% ${dynTarget.source === 'historical' ? `(hist. ${dynTarget.samples} sygn.)` : '(domyślny)'}`,
      exchange,
      currency:       exchange === 'NYSE' ? 'USD' : 'PLN',
      companyName:    null,
      horizon:        `${horizon}${dynHorizon.source === 'historical' ? ` (hist. ${dynHorizon.samples} sygn.)` : ''}`,
      interpretation: interp,
    })

    await sendTelegram(msg, IS_STAGING)

    await kv.set(alertId, {
      id: alertId, ticker: signal.ticker, strategy, exchange,
      signal: signal.signal, price: signal.price,
      score: signal.score, indexTrend,
      timestamp: now.toISOString(), targetAchieved: null,
      thresholdsAtSignal: thresholds,
      ...config.kvExtra(signal),
    }, { ex: 90 * 24 * 60 * 60 })

    sent++
  }

  res.json({ signals: signals.length, sent, exchange, strategy, indexTrend })
}
