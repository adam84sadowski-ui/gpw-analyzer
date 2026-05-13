// Server-side only — imported exclusively from api/ functions.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@vercel/kv'
import { getSector, getCorrelatedStocks } from '../indicators/sectorCorrelation.js'

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Yahoo RSS → up to 5 headlines, KV-cached 2 h
export async function fetchNewsHeadlines(ticker, exchange = 'GPW') {
  const yahooTicker = exchange === 'GPW'
    ? ticker.replace('.pl', '').toUpperCase() + '.WA'
    : ticker.toUpperCase()
  const cacheKey = `${ENV}:news:${ticker}`

  const cached = await kv.get(cacheKey).catch(() => null)
  if (cached) return cached

  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${yahooTicker}&region=US&lang=en-US`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return []
    const xml = await resp.text()
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)]
      .map(m => m[1].trim())
      .filter(t => !t.includes('Yahoo Finance') && t.length > 10)
      .slice(0, 5)
    await kv.set(cacheKey, titles, { ex: 2 * 3600 }).catch(() => {})
    return titles
  } catch {
    return []
  }
}

// Sector context for prompt building
export function buildSectorContext(ticker, exchange, openPositions = []) {
  const sector = getSector(ticker, exchange)
  const correlated = getCorrelatedStocks(ticker, exchange, 3)
  const sectorPositions = openPositions.filter(
    p => p.status === 'open' && getSector(p.ticker, p.exchange ?? exchange) === sector,
  ).length
  return { sector, correlated, sectorPositions }
}

// Claude API call with up to 2 retries
export async function callClaudeAPI(prompt, maxTokens = 300) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      })
      logAICost(msg.usage).catch(() => {})
      return msg.content[0]?.text ?? null
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastErr
}

export async function logAICost(usage) {
  if (!usage) return
  const key      = `${ENV}:ai-cost:${new Date().toISOString().slice(0, 10)}`
  const existing = await kv.get(key).catch(() => null) ?? { input: 0, output: 0, calls: 0 }
  await kv.set(key, {
    input:  existing.input  + (usage.input_tokens  ?? 0),
    output: existing.output + (usage.output_tokens ?? 0),
    calls:  existing.calls  + 1,
  }, { ex: 7 * 24 * 3600 }).catch(() => {})
}

function parseJSON(text, fallback) {
  try {
    const m = text?.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : fallback
  } catch {
    return fallback
  }
}

// AI entry validation — returns { decision, confidence, reason, risk }
export async function validateEntry({ ticker, exchange, signal, score, rsi, volMult, sma50Delta, sector, correlated, sectorPositions, news }) {
  const newsText = news?.length ? news.join('\n') : 'Brak nagłówków'
  const prompt = `Jesteś ekspertem analizy technicznej GPW i NYSE.
Oceń czy warto wejść w tę pozycję. Odpowiedz TYLKO w JSON bez markdown:
{"decision":"WEJDŹ"|"POCZEKAJ"|"ODRZUĆ","confidence":0-100,"reason":"max 2 zdania po polsku","risk":"NISKIE"|"UMIARKOWANE"|"WYSOKIE"}

Dane:
- Ticker: ${ticker} (${exchange}), sektor: ${sector}, powiązane: ${correlated.join(', ')}
- Sygnał: ${signal}, score: ${score}/100
- RSI: ${rsi}, wolumen: ${volMult}x, odch. SMA50: ${sma50Delta}%
- Otwarte pozycje w sektorze: ${sectorPositions}
- Nagłówki: ${newsText}`

  const text = await callClaudeAPI(prompt, 250)
  return parseJSON(text, { decision: 'POCZEKAJ', confidence: 50, reason: 'Błąd AI.', risk: 'UMIARKOWANE' })
}

// AI position evaluation — returns { action, confidence, reason, urgency }
export async function evaluatePosition({ ticker, exchange, signal, entryPrice, currentPrice, pnlPct, daysHeld, rsi, volMult, sma50Delta, news }) {
  const newsText = news?.length ? news.join('\n') : 'Brak nagłówków'
  const prompt = `Jesteś ekspertem analizy technicznej GPW i NYSE.
Oceń otwartą pozycję. Odpowiedz TYLKO w JSON bez markdown:
{"action":"TRZYMAJ"|"ZAMKNIJ"|"ZREDUKUJ","confidence":0-100,"reason":"max 2 zdania po polsku","urgency":"NISKA"|"UMIARKOWANA"|"WYSOKA"}

Dane:
- Ticker: ${ticker} (${exchange}), sygnał: ${signal}
- Cena wejścia: ${entryPrice}, cena bieżąca: ${currentPrice}, P&L: ${pnlPct}%
- Dni trzymania: ${daysHeld}, RSI: ${rsi}, wolumen: ${volMult}x, odch. SMA50: ${sma50Delta}%
- Nagłówki: ${newsText}`

  const text = await callClaudeAPI(prompt, 250)
  return parseJSON(text, { action: 'TRZYMAJ', confidence: 50, reason: 'Błąd AI.', urgency: 'NISKA' })
}
