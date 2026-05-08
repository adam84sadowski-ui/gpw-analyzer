import { createClient } from '@vercel/kv'
import { fetchSeasonalityData, calculateMonthlyReturns } from '../../src/indicators/seasonality.js'
import { allTickers } from '../../src/lib/universes.js'

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'
const TTL = 30 * 24 * 60 * 60

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const { exchange = 'GPW' } = req.query
  const tickers = allTickers(exchange)
  let saved = 0, failed = 0

  for (const ticker of tickers) {
    await new Promise(r => setTimeout(r, 200))  // rate-limit Yahoo
    try {
      const prices = await fetchSeasonalityData(ticker, exchange)
      if (!prices || prices.length < 60) { failed++; continue }
      const monthlyReturns = calculateMonthlyReturns(prices)
      await kv.set(`${ENV}:seasonality:${exchange}:${ticker}`, { monthlyReturns, updatedAt: new Date().toISOString() }, { ex: TTL })
      saved++
    } catch { failed++ }
  }

  res.json({ exchange, total: tickers.length, saved, failed })
}
