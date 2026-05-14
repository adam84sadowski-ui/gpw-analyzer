// Server-side only — imported exclusively from api/ functions.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@vercel/kv'
import { getSector, getCorrelatedStocks } from '../indicators/sectorCorrelation.js'
import { toYahooSymbol } from '../lib/yahoo.js'

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

// Yahoo Finance quoteSummary: P/E, analyst ratings, revenue growth — KV-cached 4h
export async function fetchQuoteSummary(ticker, exchange = 'GPW') {
  const cacheKey = `${ENV}:qsummary:${ticker}`
  const cached = await kv.get(cacheKey).catch(() => null)
  if (cached) return cached

  try {
    const symbol = toYahooSymbol(ticker, exchange)
    const modules = 'financialData,summaryDetail,defaultKeyStatistics,recommendationTrend'
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const r = json?.quoteSummary?.result?.[0]
    if (!r) return null

    const fd = r.financialData ?? {}
    const sd = r.summaryDetail ?? {}
    const ks = r.defaultKeyStatistics ?? {}
    const rt = r.recommendationTrend?.trend?.[0] ?? {}

    const summary = {
      trailingPE:        sd.trailingPE?.raw         ?? null,
      forwardPE:         sd.forwardPE?.raw          ?? null,
      priceToBook:       ks.priceToBook?.raw         ?? null,
      revenueGrowth:     fd.revenueGrowth?.raw       != null ? Math.round(fd.revenueGrowth.raw * 100) : null,
      grossMargins:      fd.grossMargins?.raw        != null ? Math.round(fd.grossMargins.raw * 100) : null,
      returnOnEquity:    fd.returnOnEquity?.raw      != null ? Math.round(fd.returnOnEquity.raw * 100) : null,
      targetMeanPrice:   fd.targetMeanPrice?.raw     ?? null,
      targetUpside:      fd.currentPrice?.raw && fd.targetMeanPrice?.raw
        ? Math.round((fd.targetMeanPrice.raw / fd.currentPrice.raw - 1) * 100)
        : null,
      recommendationKey: fd.recommendationKey       ?? null,
      analystBuy:        (rt.strongBuy ?? 0) + (rt.buy ?? 0),
      analystHold:       rt.hold                    ?? 0,
      analystSell:       (rt.sell ?? 0) + (rt.strongSell ?? 0),
      beta:              sd.beta?.raw               ?? null,
      currency:          fd.financialCurrency       ?? null,
    }
    await kv.set(cacheKey, summary, { ex: 4 * 3600 }).catch(() => {})
    return summary
  } catch {
    return null
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

function buildFundLines(f) {
  if (!f) return 'Brak danych fundamentalnych'
  return [
    f.trailingPE     != null ? `- P/E trailing: ${f.trailingPE.toFixed(1)}` : null,
    f.forwardPE      != null ? `- P/E forward: ${f.forwardPE.toFixed(1)}` : null,
    f.priceToBook    != null ? `- P/BV: ${f.priceToBook.toFixed(2)}` : null,
    f.revenueGrowth  != null ? `- Wzrost przychodów YoY: ${f.revenueGrowth > 0 ? '+' : ''}${f.revenueGrowth}%` : null,
    f.grossMargins   != null ? `- Marża brutto: ${f.grossMargins}%` : null,
    f.returnOnEquity != null ? `- ROE: ${f.returnOnEquity}%` : null,
    f.recommendationKey
      ? `- Konsensus analityków: ${f.recommendationKey.toUpperCase()} (${f.analystBuy} Kup / ${f.analystHold} Trzymaj / ${f.analystSell} Sprzedaj)` : null,
    f.targetMeanPrice != null && f.targetUpside != null
      ? `- Śr. cena docelowa: ${f.targetMeanPrice} ${f.currency ?? ''} (${f.targetUpside > 0 ? '+' : ''}${f.targetUpside}% potencjał)` : null,
    f.beta != null ? `- Beta: ${f.beta.toFixed(2)}` : null,
  ].filter(Boolean).join('\n')
}

// AI entry validation — returns { decision, confidence, reason, risk, recommendation }
export async function validateEntry({ ticker, exchange, signal, score, rsi, volMult, sma50Delta, sector, correlated, sectorPositions, news, fundamentals }) {
  const newsText = news?.length ? news.join('\n') : 'Brak nagłówków'
  const fundLines = buildFundLines(fundamentals)

  const prompt = `Jesteś doświadczonym analitykiem inwestycyjnym. Napisz profesjonalną rekomendację dla inwestora detalicznego dotyczącą otwarcia pozycji.

Odpowiedz TYLKO w JSON bez markdown (bez \`\`\`):
{
  "decision": "WEJDŹ" | "POCZEKAJ" | "ODRZUĆ",
  "confidence": 0-100,
  "reason": "2-3 zdania PL: oceń sygnał techniczny w kontekście fundamentów i konsensusu analityków",
  "risk": "NISKIE" | "UMIARKOWANE" | "WYSOKIE",
  "recommendation": "Konkretny plan działania (1-3 zdania PL): jeśli WEJDŹ — podaj sugerowaną wielkość pozycji (% portfela), poziom stop loss i uzasadnienie celu; jeśli POCZEKAJ — co musi się zmienić; jeśli ODRZUĆ — dlaczego i kiedy warto wrócić"
}

ANALIZA TECHNICZNA:
- Ticker: ${ticker} (${exchange}), sektor: ${sector}
- Sygnał: ${signal ?? 'brak'}, score jakości: ${score}/100
- RSI(14): ${rsi} | Wolumen: ${volMult}x średniej | Odchylenie od SMA50: ${sma50Delta}%
- Inne otwarte pozycje w sektorze ${sector}: ${sectorPositions}
- Spółki powiązane sektorem: ${correlated.join(', ') || 'brak'}

ANALIZA FUNDAMENTALNA:
${fundLines}

NAJNOWSZE NAGŁÓWKI:
${newsText}`

  const text = await callClaudeAPI(prompt, 500)
  return parseJSON(text, { decision: 'POCZEKAJ', confidence: 50, reason: 'Błąd AI.', risk: 'UMIARKOWANE', recommendation: 'Brak rekomendacji — spróbuj ponownie.' })
}

// AI position evaluation — returns { action, confidence, reason, urgency, modification }
export async function evaluatePosition({ ticker, exchange, signal, entryPrice, currentPrice, pnlPct, daysHeld, rsi, volMult, sma50Delta, stopLoss, target, trailingActive, news, fundamentals }) {
  const newsText = news?.length ? news.join('\n') : 'Brak nagłówków'
  const fundLines = buildFundLines(fundamentals)
  const staticStop = entryPrice && stopLoss ? (entryPrice * (1 - stopLoss / 100)).toFixed(2) : null
  const targetPrice = entryPrice && target ? (entryPrice * (1 + target / 100)).toFixed(2) : null

  const prompt = `Jesteś doświadczonym analitykiem inwestycyjnym. Napisz profesjonalną rekomendację dla inwestora detalicznego dotyczącą zarządzania otwartą pozycją.

Odpowiedz TYLKO w JSON bez markdown (bez \`\`\`):
{
  "action": "TRZYMAJ" | "ZAMKNIJ" | "ZMODYFIKUJ",
  "confidence": 0-100,
  "reason": "2-3 zdania PL: obecny stan techniczny + kontekst fundamentalny + ocena trzymania",
  "urgency": "NISKA" | "UMIARKOWANA" | "WYSOKA",
  "modification": "Wypełnij ZAWSZE (nawet dla TRZYMAJ/ZAMKNIJ): konkretne kroki zarządzania pozycją — gdzie ustawić stop loss, czy realizować część zysku/straty, jak dostosować wielkość pozycji. Np: 'Przesuń stop loss do poziomu wejścia (breakeven). Zrealizuj 30% przy +10%. Resztę trzymaj z celem +25%.'"
}

DANE POZYCJI:
- Ticker: ${ticker} (${exchange}) | Sygnał otwarcia: ${signal ?? 'brak'}
- Cena wejścia: ${entryPrice} | Cena bieżąca: ${currentPrice} | P&L: ${pnlPct > 0 ? '+' : ''}${pnlPct}%
- Dni trzymania: ${daysHeld} | Stop loss: ${trailingActive ? 'trailing aktywny' : `${stopLoss}% (${staticStop})`} | Cel: +${target}% (${targetPrice})

WSKAŹNIKI BIEŻĄCE:
- RSI(14): ${rsi} | Wolumen: ${volMult}x | Odchylenie od SMA50: ${sma50Delta}%

ANALIZA FUNDAMENTALNA:
${fundLines}

NAJNOWSZE NAGŁÓWKI:
${newsText}`

  const text = await callClaudeAPI(prompt, 500)
  return parseJSON(text, { action: 'TRZYMAJ', confidence: 50, reason: 'Błąd AI.', urgency: 'NISKA', modification: 'Brak rekomendacji — spróbuj ponownie.' })
}
