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

// Yahoo Finance quoteSummary — KV-cached 4h
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

    const freeCashflow = fd.freeCashflow?.raw ?? null
    const marketCap    = sd.marketCap?.raw    ?? null
    const fcfYield     = freeCashflow && marketCap && marketCap > 0
      ? Math.round(freeCashflow / marketCap * 1000) / 10
      : null

    const summary = {
      trailingPE:        sd.trailingPE?.raw          ?? null,
      forwardPE:         sd.forwardPE?.raw           ?? null,
      priceToBook:       ks.priceToBook?.raw          ?? null,
      revenueGrowth:     fd.revenueGrowth?.raw        != null ? Math.round(fd.revenueGrowth.raw * 100) : null,
      grossMargins:      fd.grossMargins?.raw         != null ? Math.round(fd.grossMargins.raw * 100) : null,
      operatingMargins:  fd.operatingMargins?.raw     != null ? Math.round(fd.operatingMargins.raw * 100) : null,
      returnOnEquity:    fd.returnOnEquity?.raw       != null ? Math.round(fd.returnOnEquity.raw * 100) : null,
      fcfYield,
      evEbitda:          ks.enterpriseToEbitda?.raw   ?? null,
      debtToEquity:      fd.debtToEquity?.raw         != null ? Math.round(fd.debtToEquity.raw) / 100 : null,
      high52w:           sd.fiftyTwoWeekHigh?.raw     ?? null,
      low52w:            sd.fiftyTwoWeekLow?.raw      ?? null,
      targetMeanPrice:   fd.targetMeanPrice?.raw      ?? null,
      targetUpside:      fd.currentPrice?.raw && fd.targetMeanPrice?.raw
        ? Math.round((fd.targetMeanPrice.raw / fd.currentPrice.raw - 1) * 100)
        : null,
      recommendationKey: fd.recommendationKey        ?? null,
      analystBuy:        (rt.strongBuy ?? 0) + (rt.buy ?? 0),
      analystHold:       rt.hold                     ?? 0,
      analystSell:       (rt.sell ?? 0) + (rt.strongSell ?? 0),
      beta:              sd.beta?.raw                ?? null,
      currency:          fd.financialCurrency        ?? null,
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

function na(val, format) {
  if (val == null) return 'niedostępne'
  return format ? format(val) : String(val)
}

function buildFundBlock(f) {
  if (!f) return 'Brak danych fundamentalnych'
  return [
    `P/E trailing: ${na(f.trailingPE, v => v.toFixed(1))} | Forward P/E: ${na(f.forwardPE, v => v.toFixed(1))}`,
    `ROE: ${na(f.returnOnEquity, v => v + '%')} | Marża operacyjna: ${na(f.operatingMargins, v => v + '%')}`,
    `FCF Yield: ${na(f.fcfYield, v => v + '%')} | EV/EBITDA: ${na(f.evEbitda, v => v.toFixed(1))}`,
    `Dług/Equity: ${na(f.debtToEquity, v => v.toFixed(2) + 'x')}`,
    `Wzrost przychodów YoY: ${na(f.revenueGrowth, v => (v > 0 ? '+' : '') + v + '%')}`,
    `52W zakres: ${na(f.low52w, v => v.toFixed(2))} — ${na(f.high52w, v => v.toFixed(2))} ${f.currency ?? ''}`,
    f.targetMeanPrice != null
      ? `Cel analityków: ${f.targetMeanPrice} ${f.currency ?? ''} (${f.targetUpside > 0 ? '+' : ''}${f.targetUpside}% potencjał)`
      : null,
    f.recommendationKey
      ? `Konsensus: ${f.recommendationKey.toUpperCase()} — ${f.analystBuy} Kup / ${f.analystHold} Trzymaj / ${f.analystSell} Sprzedaj`
      : null,
    f.beta != null ? `Beta: ${f.beta.toFixed(2)}` : null,
  ].filter(Boolean).join('\n')
}

// AI entry validation (Buffett/Lynch) — returns { decision, buffettScore, confidence, summary, analysis, recommendation }
export async function validateEntry({ ticker, exchange, signal, score, rsi, volMult, sma50Delta, sector, correlated, sectorPositions, news, fundamentals }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals)
  const f = fundamentals ?? {}

  const prompt = `Jesteś seniorem analitykiem inwestycyjnym z 20-letnim doświadczeniem. Łączysz metodologię Warrena Buffetta (value investing, economic moat, margin of safety) z praktyką Petera Lyncha (growth at reasonable price, timing wejścia).

Twoje zadanie: profesjonalna ocena czy warto wejść w tę spółkę i jak to zrobić optymalnie.

═══════════════════════════════════════════
DANE SPÓŁKI
═══════════════════════════════════════════
Spółka: ${ticker} | ${exchange} | Sektor: ${sector}
Sygnał techniczny: ${signal ?? 'brak'} | Score: ${score}/100
RSI: ${rsi} | Wolumen: ${volMult}x średniej | vs SMA50: ${sma50Delta}%
Inne pozycje w sektorze: ${sectorPositions} | Korelowane: ${correlated.join(', ') || 'brak'}

WSKAŹNIKI FUNDAMENTALNE:
${fundBlock}

NEWSY (ostatnie 5):
${newsLines}

═══════════════════════════════════════════

Odpowiedz TYLKO w JSON bez markdown. Pole "analysis" to pełna checklist Buffetta jako string z \\n dla nowych linii. Pole "recommendation" to plan wejścia.

{
  "decision": "WEJDŹ" | "OBSERWUJ" | "UNIKAJ",
  "buffettScore": <liczba 0-10 ile checkpoints Buffetta jest spełnionych>,
  "confidence": <0-100>,
  "summary": "<jedno zdanie: najważniejsza rzecz którą powinieneś wiedzieć o tej spółce>",
  "analysis": "<pełna checklist 10 punktów Buffetta w formacie:\\n1. CIRCLE OF COMPETENCE\\n[✅/⚠️/❌] ocena + 1 zdanie\\n\\n2. ECONOMIC MOAT\\n[✅/⚠️/❌] ocena + 1 zdanie\\n\\n3. EARNINGS CONSISTENCY\\n[✅/⚠️/❌] ocena + dane\\n\\n4. RETURN ON EQUITY\\n[✅/⚠️/❌] ocena + wartość\\n\\n5. FREE CASH FLOW\\n[✅/⚠️/❌] ocena + wartość\\n\\n6. DŁUG\\n[✅/⚠️/❌] ocena + wartość\\n\\n7. MANAGEMENT QUALITY\\n[✅/⚠️/❌] ocena + 1 zdanie\\n\\n8. MARGIN OF SAFETY\\n[✅/⚠️/❌] cena vs cel analityków + obliczenie\\n\\n9. REKOMENDACJE INSTYTUCJONALNE\\n[✅/⚠️/❌] konsensus + liczby\\n\\n10. RYZYKO SPECYFICZNE\\n[⚠️] lista 2-3 ryzyk dla tej spółki">",
  "recommendation": "<gdy WEJDŹ lub OBSERWUJ: KIEDY WEJŚĆ: [konkretny warunek]\\n\\nSCALE IN:\\nTransza 1: X% kapitału gdy [warunek] | Cena: ~X\\nTransza 2: X% kapitału gdy [warunek] | Cena: ~X\\n\\nPARAMETRY:\\nStop loss: -X% | Cel min: +X% | Cel opt: +X% | Horyzont: X tyg/mies\\n\\nNASTĘPNY PRZEGLĄD: [data lub wydarzenie] — co sprawdzić: [lista]\\n\\nGdy UNIKAJ: dlaczego i kiedy warto wrócić>"
}`

  const text = await callClaudeAPI(prompt, 2000)
  return parseJSON(text, {
    decision: 'OBSERWUJ', buffettScore: 5, confidence: 50,
    summary: 'Błąd AI — spróbuj ponownie.',
    analysis: 'Analiza niedostępna.',
    recommendation: 'Brak rekomendacji — spróbuj ponownie.',
  })
}

// AI position evaluation (Buffett thesis check) — returns { action, confidence, reason, urgency, modification }
export async function evaluatePosition({ ticker, exchange, signal, entryPrice, currentPrice, pnlPct, daysHeld, rsi, volMult, sma50Delta, stopLoss, target, trailingActive, news, fundamentals }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals)
  const staticStop  = entryPrice && stopLoss  ? (entryPrice * (1 - stopLoss / 100)).toFixed(2)  : null
  const targetPrice = entryPrice && target     ? (entryPrice * (1 + target / 100)).toFixed(2)    : null

  const prompt = `Jesteś seniorem analitykiem inwestycyjnym. Oceniasz otwartą pozycję przez pryzmat Buffetta: czy teza inwestycyjna nadal obowiązuje, czy fundamenty się zmieniły, i jak optymalnie zarządzać pozycją.

Odpowiedz TYLKO w JSON bez markdown (bez \`\`\`):
{
  "action": "TRZYMAJ" | "ZAMKNIJ" | "ZMODYFIKUJ",
  "confidence": 0-100,
  "reason": "2-3 zdania PL: czy teza inwestycyjna nadal obowiązuje? Co zmieniło się technicznie i fundamentalnie od wejścia?",
  "urgency": "NISKA" | "UMIARKOWANA" | "WYSOKA",
  "modification": "Wypełnij ZAWSZE: konkretny plan zarządzania pozycją — gdzie stop loss, kiedy realizować zysk/stratę częściowo, co monitorować. Buffett: 'trzymaj aż zmienią się fundamenty, nie cena'. Lynch: 'sprzedaj gdy historia się kończy'. Zastosuj odpowiednią filozofię do tej sytuacji."
}

DANE POZYCJI:
- Ticker: ${ticker} (${exchange}) | Sygnał otwarcia: ${signal ?? 'brak'}
- Cena wejścia: ${entryPrice} | Cena bieżąca: ${currentPrice} | P&L: ${pnlPct > 0 ? '+' : ''}${pnlPct}%
- Dni trzymania: ${daysHeld} | Stop: ${trailingActive ? 'trailing aktywny' : `${stopLoss}% (${staticStop})`} | Cel: +${target}% (${targetPrice})

WSKAŹNIKI BIEŻĄCE:
- RSI: ${rsi} | Wolumen: ${volMult}x | vs SMA50: ${sma50Delta}%

FUNDAMENTY:
${fundBlock}

NEWSY:
${newsLines}`

  const text = await callClaudeAPI(prompt, 1000)
  return parseJSON(text, { action: 'TRZYMAJ', confidence: 50, reason: 'Błąd AI.', urgency: 'NISKA', modification: 'Brak rekomendacji — spróbuj ponownie.' })
}
