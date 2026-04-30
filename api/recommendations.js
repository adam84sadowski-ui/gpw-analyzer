import { createClient } from '@vercel/kv'

const ENV_PREFIX = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'
const CACHE_TTL_MS = 25 * 60 * 1000
const cache = new Map()

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

async function fetchYahooDaily(yahooTicker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=1d&range=1y&includePrePost=false`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const ts = result.timestamp ?? []
  const q  = result.indicators.quote[0]
  return ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().slice(0, 10),
      open:   q.open[i]   ? Math.round(q.open[i]   * 100) / 100 : null,
      high:   q.high[i]   ? Math.round(q.high[i]   * 100) / 100 : null,
      low:    q.low[i]    ? Math.round(q.low[i]    * 100) / 100 : null,
      close:  q.close[i]  ? Math.round(q.close[i]  * 100) / 100 : null,
      volume: q.volume[i] ?? null,
    }))
    .filter(c => c.close !== null)
}

const TICKER_MAP = { 'kghm.pl': 'KGH.WA', 'mwig40.pl': 'MWIG40.WA', 'swig80.pl': 'SWIG80.WA' }
function toYahoo(ticker) {
  const t = ticker.toLowerCase()
  return TICKER_MAP[t] ?? t.replace(/\.pl$/, '').toUpperCase() + '.WA'
}

const UNIVERSES = {
  scalping:   ['pkn.pl', 'kghm.pl', 'pko.pl', 'pzu.pl', 'cdr.pl', 'ale.pl', 'mbk.pl', 'lpp.pl', 'pge.pl', 'jsw.pl'],
  swing:      ['ccc.pl', 'dnp.pl', 'kru.pl', 'acp.pl', 'bdx.pl', 'cps.pl', 'kty.pl', 'lvc.pl', 'mab.pl'],
  aggressive: ['ans.pl', 'apr.pl', 'cal.pl', 'xtp.pl', 'slv.pl', 'vrc.pl', 'wpl.pl'],
}

const STRATEGY_CONFIG = {
  scalping:   { target: 5,  stopLoss: 3,  label: '⚡ Scalping' },
  swing:      { target: 15, stopLoss: 5,  label: '📈 Swing' },
  aggressive: { target: 35, stopLoss: 8,  label: '🚀 Agresywna' },
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gains += d; else losses -= d
  }
  let ag = gains / period, al = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    ag = (ag * (period - 1) + Math.max(d, 0)) / period
    al = (al * (period - 1) + Math.max(-d, 0)) / period
  }
  if (al === 0) return 100
  return Math.round((100 - 100 / (1 + ag / al)) * 100) / 100
}

function calcSMA(closes, period) {
  if (closes.length < period) return null
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period
}

function avgVol(volumes, period = 20) {
  if (volumes.length < period) return null
  return volumes.slice(-period).reduce((a, b) => a + b, 0) / period
}

function detectSignal(candles, strategy, thresholds = {}) {
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const rsi     = calcRSI(closes)
  const sma20   = calcSMA(closes, 20)
  const sma50   = calcSMA(closes, 50)
  const avg     = avgVol(volumes)
  const volMult = avg ? Math.round((volumes[volumes.length - 1] / avg) * 100) / 100 : null
  const price   = closes[closes.length - 1]

  if (strategy === 'scalping') {
    const rsiThr = thresholds.rsi_threshold ?? 30
    const volThr = thresholds.volume_multiplier ?? 2
    if (rsi !== null && rsi < rsiThr && volMult && volMult >= volThr) {
      return { signal: 'RSI_OVERSOLD', rsi, volMult, sma20, sma50, price }
    }
  }
  if (strategy === 'swing') {
    const prevClose = closes[closes.length - 2]
    const prevSMA50 = closes.length >= 51 ? closes.slice(-51, -1).reduce((a, b) => a + b, 0) / 50 : null
    if (prevSMA50 && prevClose <= prevSMA50 && price > sma50 && volMult && volMult >= 1.5) {
      return { signal: 'SMA50_CROSSOVER', volMult, sma20, sma50, price }
    }
  }
  if (strategy === 'aggressive') {
    const max20 = Math.max(...candles.slice(-21, -1).map(c => c.high))
    if (price > max20 && rsi && rsi > 60 && volMult && volMult >= 3) {
      return { signal: 'BREAKOUT', rsi, volMult, sma20, sma50, price }
    }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { strategy = 'swing' } = req.query
  const universe = UNIVERSES[strategy]
  if (!universe) return res.status(400).json({ error: 'Unknown strategy' })

  const cacheKey = `rec_${strategy}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return res.json(hit.data)

  const thresholds = await kv.get(`${ENV_PREFIX}:thresholds`) ?? {}
  const config = STRATEGY_CONFIG[strategy]
  const results = []

  for (const ticker of universe) {
    try {
      const candles = await fetchYahooDaily(toYahoo(ticker))
      if (!candles || candles.length < 25) continue
      const sig = detectSignal(candles, strategy, thresholds)
      if (sig) {
        results.push({
          ticker,
          tickerDisplay: ticker.replace('.pl', '').toUpperCase(),
          strategy,
          label: config.label,
          target: config.target,
          stopLoss: config.stopLoss,
          timestamp: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          ...sig,
        })
      }
    } catch (e) {
      console.error(`recommendations: error scanning ${ticker}:`, e.message)
    }
  }

  cache.set(cacheKey, { data: results, ts: Date.now() })
  res.json(results)
}
