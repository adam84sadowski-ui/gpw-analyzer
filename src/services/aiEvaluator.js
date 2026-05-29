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

// AI entry validation — returns { decision, buffettScore, confidence, summary, analysis, recommendation }
// strategy: 'scalping' → PTJ framework, 'aggressive' → O'Neil CANSLIM, 'swing' → Buffett/Lynch
export async function validateEntry({ ticker, exchange, signal, score, rsi, volMult, sma50Delta, signalPrice, livePrice, sector, correlated, sectorPositions, news, fundamentals, strategy = 'swing' }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals)

  const priceDriftPct = signalPrice && livePrice
    ? Math.round((livePrice - signalPrice) / signalPrice * 1000) / 10
    : null
  const priceBlock = signalPrice
    ? `Cena sygnału: ${signalPrice}${livePrice ? ` | Cena aktualna: ${livePrice}` : ''}${priceDriftPct != null ? ` | Dryft od sygnału: ${priceDriftPct > 0 ? '+' : ''}${priceDriftPct}%` : ''}${priceDriftPct != null && Math.abs(priceDriftPct) >= 5 ? ' ⚠️ CENA ODESZŁA OD SYGNAŁU — uwzględnij to w ocenie' : ''}`
    : null

  const dataBlock = `Spółka: ${ticker} | ${exchange} | Sektor: ${sector}
Sygnał: ${signal ?? 'brak'} | Score: ${score}/100
RSI: ${rsi} | Wolumen: ${volMult}x | vs SMA50: ${sma50Delta}%${priceBlock ? `\n${priceBlock}` : ''}
Inne pozycje w sektorze: ${sectorPositions} | Korelowane: ${correlated.join(', ') || 'brak'}

WSKAŹNIKI FUNDAMENTALNE:
${fundBlock}

NEWSY (ostatnie 5):
${newsLines}`

  const jsonSchema = `Odpowiedz TYLKO w JSON bez markdown. buffettScore = wynik 0-10 (proporcja z 12 kryteriów × 10/12, zaokrąglij do 1 miejsca).
{
  "decision": "WEJDŹ" | "OBSERWUJ" | "UNIKAJ",
  "buffettScore": <0-10>,
  "confidence": <0-100>,
  "summary": "<jedno zdanie: najważniejsza rzecz o tym setupie>",
  "analysis": "<checklist 12 punktów z \\n, każdy: NAZWA\\n[✅/⚠️/❌] ocena + 1 zdanie/dane>",
  "recommendation": "<KIEDY WEJŚĆ / dlaczego UNIKAJ | PARAMETRY: Stop -X%, Cel +X%, Horyzont X dni>"
}`

  let prompt
  if (strategy === 'scalping') {
    prompt = `Jesteś traderem momentum w stylu Paul Tudor Jones (PTJ). Filozofia: dyscyplina ryzyka absolutna, R/R ≥ 2:1, natychmiastowe cięcie gdy rynek mówi "nie". Horyzont: 2-5 dni. Target +5%, Stop -3%.

Twoje zadanie: oceń ten setup SCALPINGOWY — czy wchodzisz, czy czekasz, czy omijasz.

${dataBlock}

═══════════════
${jsonSchema}

Punkty w "analysis" (12 kryteriów PTJ):
1. MOMENTUM SETUP — RSI < 35 + wolumen: czy wyprzedanie autentyczne?
2. VOLUME CONFIRMATION — wolumen ≥ 1.5x: czy popyt rzeczywiście rośnie?
3. RISK/REWARD — target +5% / stop -3% = 1.67x R/R; czy akceptowalne w tym kontekście?
4. TREND RYNKOWY — indeks w up/sideways/down? "Never fight the tape"
5. RELATIVE STRENGTH — czy spółka zachowuje się silniej niż sektor?
6. STOP TECHNICZNY — czy istnieje czyste wsparcie poniżej ceny wejścia?
7. CATALYST RYZYKA — earnings, dywidenda, event w ciągu 5 dni sesji?
8. PŁYNNOŚĆ — czy wolumen pozwala na wyjście bez slippage?
9. SENTIMENT NEWSOWY — newsy neutralne/pozytywne? Negatywne to dealbreaker
10. JAKOŚĆ SYGNAŁU TECHNICZNEGO — score/100: wiarygodność setupu
11. KORELACJA PORTFELOWA — ile otwartych pozycji w tym sektorze?
12. PLAN WYJŚCIA — jasny trigger take-profit i stop-loss bez emocji`
  } else if (strategy === 'aggressive') {
    prompt = `Jesteś analitykiem w stylu William O'Neil (CANSLIM). Szukasz spółek z przyspieszającymi zyski, wybijającymi się z prawidłowych baz z wolumenem ≥ 1.5x. Filozofia: "Cut losses at 7-8%, let winners run." Horyzont: 1-4 tygodnie. Target +35%, Stop -8%.

Twoje zadanie: oceń ten BREAKOUT przez pryzmat CANSLIM — czy to autentyczne wybicie lidera?

${dataBlock}

═══════════════
${jsonSchema}

Punkty w "analysis" (12 kryteriów O'Neil CANSLIM):
1. C — CURRENT EARNINGS — EPS/przychody kw/kw: ≥ +25% = silny sygnał
2. A — ANNUAL EARNINGS — trend 3-letni: konsekwentny wzrost?
3. N — NOVELTY — nowy produkt/rynek/management/52W high proximity?
4. S — SUPPLY/DEMAND — wolumen na wybiciu: ≥ 1.5x = instytucjonalne zainteresowanie
5. L — LEADER OR LAGGARD — siła relatywna vs sektor: top 15%?
6. I — INSTITUTIONAL SPONSORSHIP — rekomendacje Kup vs Sprzedaj
7. M — MARKET DIRECTION — indeks w uptrend? Nie kupuj podczas korekty rynku
8. BAZA TECHNICZNA — jak długo konsolidacja przed wybieniem? (min. 3 tygodnie = lepsza baza)
9. JAKOŚĆ WYBICIA — RSI > 60 + close blisko high dnia = siłowe wybicie
10. BETA / ZMIENNOŚĆ — ryzyko specyficzne dla tego setup'u agresywnego
11. MOMENTUM FUNDAMENTÓW — wzrost przychodów YoY: przyspiesza czy hamuje?
12. REGUŁA SPRZEDAŻY O'NEIL — kiedy bezwarunkowo wychodzimy (-7-8% od wejścia lub specyficzne warunki)`
  } else {
    prompt = `Jesteś seniorem analitykiem inwestycyjnym z 20-letnim doświadczeniem. Łączysz metodologię Warrena Buffetta (value investing, economic moat, margin of safety) z praktyką Petera Lyncha (growth at reasonable price, timing wejścia).

Twoje zadanie: profesjonalna ocena czy warto wejść w tę spółkę i jak to zrobić optymalnie. Horyzont: 4-8 tygodni.

${dataBlock}

═══════════════
${jsonSchema}

Punkty w "analysis" (12 kryteriów Buffett/Lynch):
1. CIRCLE OF COMPETENCE — czy rozumiemy model biznesowy tej spółki?
2. ECONOMIC MOAT — przewaga konkurencyjna: marka, sieć, koszty przełączenia?
3. EARNINGS CONSISTENCY — zyski stabilne od 3+ lat?
4. RETURN ON EQUITY — ROE: > 15% = dobry, > 20% = świetny
5. FREE CASH FLOW — FCF Yield: > 5% = atrakcyjny
6. DŁUG — Dług/Equity: < 0.5 bezpieczne, > 1.0 ryzykowne
7. MANAGEMENT QUALITY — alokacja kapitału, historia decyzji
8. MARGIN OF SAFETY — cena vs cel analityków: upside > 20%?
9. REKOMENDACJE INSTYTUCJONALNE — konsensus Kup/Trzymaj/Sprzedaj
10. LYNCH — WZROST vs WYCENA (PEG) — P/E / wzrost przych.: PEG < 1 tanie, > 2 drogie
11. WYCENA RYNKOWA — EV/EBITDA + Forward P/E vs sektor
12. RYZYKO SPECYFICZNE — 2-3 konkretne ryzyka dla tej spółki`
  }

  prompt += `\n\nDla "recommendation":\n- WEJDŹ/OBSERWUJ: KIEDY WEJŚĆ + PARAMETRY (Stop loss, Cel, Horyzont) + NASTĘPNY PRZEGLĄD\n- UNIKAJ: konkretny powód + kiedy warto wrócić`

  const text = await callClaudeAPI(prompt, 2000)
  return parseJSON(text, {
    decision: 'OBSERWUJ', buffettScore: 5, confidence: 50,
    summary: 'Błąd AI — spróbuj ponownie.',
    analysis: 'Analiza niedostępna.',
    recommendation: 'Brak rekomendacji — spróbuj ponownie.',
  })
}

// AI position evaluation — returns { action, confidence, reason, urgency, modification }
// strategy: 'scalping' → PTJ lens, 'aggressive' → O'Neil lens, 'swing' → Buffett/Lynch lens
export async function evaluatePosition({ ticker, exchange, signal, entryPrice, currentPrice, pnlPct, daysHeld, rsi, volMult, sma50Delta, stopLoss, target, trailingActive, news, fundamentals, strategy = 'swing' }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals)
  const staticStop  = entryPrice && stopLoss  ? (entryPrice * (1 - stopLoss / 100)).toFixed(2)  : null
  const targetPrice = entryPrice && target     ? (entryPrice * (1 + target / 100)).toFixed(2)    : null
  const pnlNum      = Number(pnlPct)
  const nearTarget  = target > 0 && pnlNum >= target * 0.7

  const posBlock = `DANE POZYCJI:
- Ticker: ${ticker} (${exchange}) | Strategia: ${strategy} | Sygnał otwarcia: ${signal ?? 'brak'}
- Cena wejścia: ${entryPrice} | Cena bieżąca: ${currentPrice} | P&L: ${pnlNum > 0 ? '+' : ''}${pnlNum}%
- Dni trzymania: ${daysHeld} | Stop: ${trailingActive ? 'trailing aktywny' : `${stopLoss}% (${staticStop})`} | Cel: +${target}% (${targetPrice})${nearTarget ? ` ⚠️ BLISKO CELU` : ''}

WSKAŹNIKI BIEŻĄCE:
- RSI: ${rsi} | Wolumen: ${volMult}x | vs SMA50: ${sma50Delta}%

FUNDAMENTY:
${fundBlock}

NEWSY:
${newsLines}`

  const jsonSchema = `Odpowiedz TYLKO w JSON bez markdown:
{
  "action": "TRZYMAJ" | "ZAMKNIJ" | "ZMODYFIKUJ",
  "confidence": <0-100>,
  "reason": "<2-3 zdania PL: (1) czy teza nadal obowiązuje? (2) czy kupiłbyś tę spółkę DZISIAJ po obecnej cenie? (3) co zmieniło się od wejścia?>",
  "urgency": "NISKA" | "UMIARKOWANA" | "WYSOKA",
  "modification": "<ZAWSZE wypełnij: konkretny plan — stop loss, realizacja częściowa (jeśli blisko celu — rozważ sprzedaż 50%), co monitorować, następny przegląd>"
}`

  let persona
  if (strategy === 'scalping') {
    persona = `Jesteś traderem w stylu Paul Tudor Jones. Oceniasz krótkoterminową pozycję (target +5%, stop -3%, horyzont 2-5 dni). Twoja zasada: "Losers average losers" — jeśli setup jest zepsuty, wychodź natychmiast. Sprawdź: czy momentum nadal działa? R/R nadal korzystne? Czy trzymanie przez kolejny dzień ma sens?`
  } else if (strategy === 'aggressive') {
    persona = `Jesteś analitykiem w stylu William O'Neil. Oceniasz pozycję BREAKOUT (target +35%, stop -8%). Twoja zasada: "The whole secret to winning big in the stock market is not to be right all the time, but to lose the least amount possible when you're wrong." Sprawdź: czy wybicie nadal "działa poprawnie" (acting right)? Wolumen podtrzymuje ruch? Fundamenty (EPS) przyspieszyły czy zwolniły od wejścia?`
  } else {
    persona = `Jesteś seniorem analitykiem w stylu Buffett/Lynch. Oceniasz pozycję swing (target +15%, stop -5%, horyzont 4-8 tygodni). Buffett: "trzymaj aż zmienią się fundamenty, nie cena". Lynch: "sprzedaj gdy historia się kończy". Sprawdź integralność tezy: czy powód dla którego wszedłeś nadal obowiązuje?`
  }

  const prompt = `${persona}

${posBlock}

${jsonSchema}`

  const text = await callClaudeAPI(prompt, 1000)
  return parseJSON(text, { action: 'TRZYMAJ', confidence: 50, reason: 'Błąd AI.', urgency: 'NISKA', modification: 'Brak rekomendacji — spróbuj ponownie.' })
}
