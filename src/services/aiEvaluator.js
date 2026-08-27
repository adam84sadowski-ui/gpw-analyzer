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

// Yahoo Finance crumb auth — cached 30 min in-memory
let _crumbCache = null
async function fetchYahooCrumb() {
  if (_crumbCache && Date.now() - _crumbCache.ts < 30 * 60 * 1000) return _crumbCache

  try {
    // Step 1: get cookie from Yahoo consent page
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    })
    const setCookie = cookieRes.headers.get('set-cookie') ?? ''
    const cookie = setCookie.split(';')[0]

    // Step 2: get crumb using cookie
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!crumbRes.ok) return null
    const crumb = await crumbRes.text()
    if (!crumb || crumb.includes('{')) return null

    _crumbCache = { crumb: crumb.trim(), cookie, ts: Date.now() }
    return _crumbCache
  } catch {
    return null
  }
}

// Yahoo Finance quoteSummary — KV-cached 4h, crumb auth with knowledge fallback
export async function fetchQuoteSummary(ticker, exchange = 'GPW') {
  const cacheKey = `${ENV}:qsummary:${ticker}`
  const cached = await kv.get(cacheKey).catch(() => null)
  if (cached) return cached

  try {
    const symbol = toYahooSymbol(ticker, exchange)
    const modules = 'financialData,summaryDetail,defaultKeyStatistics,recommendationTrend,calendarEvents'
    const auth = await fetchYahooCrumb().catch(() => null)
    const crumbParam = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : ''
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}${crumbParam}`
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(auth?.cookie ? { 'Cookie': auth.cookie } : {}),
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const json = await res.json()
    const r = json?.quoteSummary?.result?.[0]
    if (!r) return null

    const fd = r.financialData ?? {}
    const sd = r.summaryDetail ?? {}
    const ks = r.defaultKeyStatistics ?? {}
    const rt = r.recommendationTrend?.trend?.[0] ?? {}
    const ce = r.calendarEvents ?? {}
    const earningsTs = ce.earnings?.earningsDate?.[0]?.raw ?? null
    const earningsDate = earningsTs ? new Date(earningsTs * 1000).toISOString().slice(0, 10) : null

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
      earningsDate,
    }
    await kv.set(cacheKey, summary, { ex: 4 * 3600 }).catch(() => {})
    return summary
  } catch {
    return null
  }
}

function buildSectorEventContext(sector) {
  const map = {
    'Energy':         'EIA oil inventory (środa 10:30 ET), decyzje OPEC, Henry Hub gas prices, sezonowość: Q4 popyt ogrzewania',
    'Technology':     'Wyniki kwartalne FAANG/MAANG, konferencje: CES (styczeń), COMPUTEX (maj), AI capex surveys, ogłoszenia produktowe',
    'Semiconductors': 'TSMC miesięczne wyniki sprzedaży, SEMI book-to-bill, fab utilization reports, konferencje: SEMICON, Hot Chips',
    'Financials':     'Decyzje FOMC (8x rocznie), CPI/PPI (ok. 10-15 każdego miesiąca), stress-testy Fed (Q2), wyniki banków (pocz. kwartału)',
    'Defense':        'Budżet DoD/Kongres (NDAA), przetargi rządowe, eskalacje/deeskalacje geopolityczne, posiedzenia NATO',
    'Aerospace':      'Okna startowe, kontrakty NASA/DoD, FCC spectrum auctions, FAA regulatory milestones',
    'Space':          'Okna startowe, kontrakty NASA/DoD, FCC spectrum auctions, FAA regulatory milestones',
    'Materials':      'Ceny LME (Cu, Al, Li), chińskie PMI przemysłowe (1. dzień miesiąca), OPEC production cuts, mining output',
    'Healthcare':     'FDA approvals / PDUFA dates, wyniki kliniczne Phase 2/3, CMS pricing decisions, FDA AdCom meetings',
    'Consumer':       'Retail sales (co miesiąc), consumer confidence (Conference Board), sezonowość: Q4 holiday, Q1 post-holiday',
    'Utilities':      'Decyzje FERC, temperatura (heating/cooling degree days), natural gas storage reports',
    'Real Estate':    'Decyzje Fed (stopy), housing starts/permits (miesięcznie), Case-Shiller index',
    'Industrials':    'ISM Manufacturing PMI (1. dzień roboczy miesiąca), durable goods orders, infrastructure spending bills',
  }
  const key = Object.keys(map).find(k => sector?.toLowerCase().includes(k.toLowerCase()))
  return key ? map[key] : 'Monitoruj: CPI, decyzje Fed, PMI przemysłowy oraz eventy specyficzne dla tej branży'
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

function clampSuggestedTarget(pct, strategy) {
  if (pct == null || typeof pct !== 'number' || !isFinite(pct)) return null
  const max = { scalping: 15, swing: 45, aggressive: 100, long_term: 200 }[strategy] ?? 45
  return Math.max(1, Math.min(Math.round(pct), max))
}

const DEFAULT_STOP = { scalping: 3, swing: 5, aggressive: 8, long_term: 10 }
function clampSuggestedStopLoss(pct, strategy) {
  if (pct == null || typeof pct !== 'number' || !isFinite(pct) || pct <= 0) return null
  const def = DEFAULT_STOP[strategy] ?? 5
  const max = def * 2
  if (pct <= def) return null  // don't return default — null means "no change"
  return Math.min(Math.round(pct), max)
}

const ALLOWED_ADD_SIZES = [25, 50, 100]
function clampSuggestedAddSize(pct, strategy) {
  if (strategy === 'scalping') return null  // never add to scalping — horizon too short
  if (pct == null || typeof pct !== 'number' || !isFinite(pct) || pct <= 0) return null
  const closest = ALLOWED_ADD_SIZES.reduce((a, b) => Math.abs(b - pct) < Math.abs(a - pct) ? b : a)
  return closest
}

function na(val, format) {
  if (val == null) return 'niedostępne'
  return format ? format(val) : String(val)
}

function buildFundBlock(f, ticker) {
  if (!f) return `BRAK DANYCH Z API — użyj wiedzy treningowej dla ${ticker ?? 'tej spółki'}. Podaj szacunkowe wartości oznaczone [~est.] i oceń je. Nie pisz "brak danych" — wiesz co to za spółka.`
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
export async function validateEntry({ ticker, exchange, signal, score, rsi, volMult, sma50Delta, signalPrice, livePrice, sector, correlated, sectorPositions, news, fundamentals, priceAction = null, strategy = 'swing' }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals, ticker)

  const priceDriftPct = signalPrice && livePrice
    ? Math.round((livePrice - signalPrice) / signalPrice * 1000) / 10
    : null
  const priceBlock = signalPrice
    ? `Cena sygnału: ${signalPrice}${livePrice ? ` | Cena aktualna: ${livePrice}` : ''}${priceDriftPct != null ? ` | Dryft od sygnału: ${priceDriftPct > 0 ? '+' : ''}${priceDriftPct}%` : ''}${priceDriftPct != null && Math.abs(priceDriftPct) >= 5 ? ' ⚠️ CENA ODESZŁA OD SYGNAŁU — uwzględnij to w ocenie' : ''}`
    : null

  const paWarning = priceAction && Math.abs(priceAction.change1d) >= 7
    ? ` ⚠️ GWAŁTOWNY RUCH — ryzyko korekty`
    : ''
  const priceActionBlock = priceAction
    ? `Zmiana 1 sesja: ${priceAction.change1d > 0 ? '+' : ''}${priceAction.change1d}%${paWarning} | Zmiana 5 sesji: ${priceAction.change5d > 0 ? '+' : ''}${priceAction.change5d}% | High vs Close ostatniej sesji: +${priceAction.highVsClose}%${priceAction.highVsClose >= 3 ? ' ⚠️ cena zamknięta daleko od szczytu — słabe zamknięcie' : ''}`
    : null

  const earningsDate = fundamentals?.earningsDate ?? null
  let earningsLine = ''
  if (earningsDate) {
    const daysUntil = Math.ceil((new Date(earningsDate) - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysUntil >= 0 && daysUntil <= 3) {
      earningsLine = strategy === 'scalping'
        ? `⚠️ DEALBREAKER EARNINGS: Wyniki za ${daysUntil} ${daysUntil === 1 ? 'dzień' : 'dni'} (${earningsDate}) — gap risk niszczy R/R 1.67x.`
        : `⚠️ WYNIKI ZA ${daysUntil} ${daysUntil === 1 ? 'DZIEŃ' : 'DNI'} (${earningsDate}) — ekstremalne ryzyko luki cenowej przez noc.`
    } else if (daysUntil > 3 && daysUntil <= 7) {
      earningsLine = strategy === 'aggressive'
        ? `📈 EARNINGS PROXIMITY: Wyniki za ${daysUntil} dni (${earningsDate}) — potencjał run-up przed publikacją. Zaplanuj wyjście przed wynikami lub trzymaj z tight stopem.`
        : `⚠️ Wyniki za ${daysUntil} dni (${earningsDate}) — uwzględnij jako granicę horyzontu.`
    } else if (daysUntil > 7) {
      earningsLine = `Najbliższe wyniki: ${earningsDate} (za ${daysUntil} dni).`
    }
  }

  const sectorEvents = buildSectorEventContext(sector)

  const f = fundamentals
  const totalAnalysts = (f?.analystBuy ?? 0) + (f?.analystHold ?? 0) + (f?.analystSell ?? 0)
  const buyPct = totalAnalysts > 0 ? Math.round((f.analystBuy ?? 0) / totalAnalysts * 100) : null
  const analystVerBlock = f?.targetMeanPrice != null
    ? `\n🎯 WERYFIKACJA CELU ANALITYKÓW — sprawdź jako PIERWSZE:
Mediana celu: ${f.targetMeanPrice} ${f.currency ?? ''} | Potencjał vs bieżąca cena: ${f.targetUpside > 0 ? '+' : ''}${f.targetUpside}%
Konsensus: ${f.recommendationKey?.toUpperCase() ?? '?'} — ${f.analystBuy ?? 0} Kup / ${f.analystHold ?? 0} Trzymaj / ${f.analystSell ?? 0} Sprzedaj (${buyPct ?? '?'}% Kup)
→ Jeśli Kup ≥60% i potencjał > 2× domyślny cel strategii → suggestedTargetPct = targetUpside. Uzasadnij w recommendation.\n`
    : `\n🎯 WERYFIKACJA CELU ANALITYKÓW: brak danych → suggestedTargetPct = domyślny cel strategii.\n`

  const dataBlock = `Spółka: ${ticker} | ${exchange} | Sektor: ${sector}
Sygnał: ${signal ?? 'brak'} | Score: ${score}/100
RSI: ${rsi} | Wolumen: ${volMult}x | vs SMA50: ${sma50Delta}%${priceBlock ? `\n${priceBlock}` : ''}${priceActionBlock ? `\nZachowanie kursu: ${priceActionBlock}` : ''}${earningsLine ? `\n${earningsLine}` : ''}
Inne pozycje w sektorze: ${sectorPositions} | Korelowane: ${correlated.join(', ') || 'brak'}
${analystVerBlock}
📅 EVENTY SEKTOROWE — uwzględnij w analizie:
${sectorEvents}

WSKAŹNIKI FUNDAMENTALNE:
${fundBlock}

NEWSY (ostatnie 5):
${newsLines}`

  const jsonSchema = `Odpowiedz TYLKO w JSON bez markdown. buffettScore = wynik 0-10 (proporcja z 13 kryteriów × 10/13, zaokrąglij do 1 miejsca). compositeScore = synteza końcowa 0-100: techniczny score (waga 40%) + buffettScore×10 (waga 35%) + potwierdzenie analitykami/makro (waga 25%). signalStrength: SŁABY (<40), UMIARKOWANY (40-54), SILNY (55-74), BARDZO SILNY (≥75).
{
  "decision": "WEJDŹ" | "OBSERWUJ" | "UNIKAJ",
  "buffettScore": <0-10>,
  "compositeScore": <0-100>,
  "signalStrength": "SŁABY" | "UMIARKOWANY" | "SILNY" | "BARDZO SILNY",
  "confidence": <0-100>,
  "summary": "<jedno zdanie: najważniejsza rzecz o tym setupie>",
  "analysis": "<checklist 13 punktów z \\n, każdy: NAZWA\\n[✅/⚠️/❌] ocena + 1 zdanie/dane>",
  "recommendation": "<KIEDY WEJŚĆ / dlaczego UNIKAJ | PARAMETRY: Stop -X%, Cel +X%, Horyzont X dni>",
  "entryZoneMin": <liczba lub null — minimalna cena strefy wejścia gdy OBSERWUJ, null gdy WEJDŹ/UNIKAJ>,
  "entryZoneMax": <liczba lub null — maksymalna cena strefy wejścia gdy OBSERWUJ, null gdy WEJDŹ/UNIKAJ>,
  "reviewDays": <liczba dni do następnego przeglądu gdy OBSERWUJ, null w pozostałych przypadkach>,
  "suggestedTargetPct": <liczba całkowita % lub null — AI-determined target od ceny wejścia. Gdy targetUpside dostępny i analystBuy ≥60% całości: użyj targetUpside. Gdy brak danych analityków: użyj domyślnego celu strategii (scalping=5, swing=15, aggressive=35). null tylko gdy decision=UNIKAJ>
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
12. PLAN WYJŚCIA — jasny trigger take-profit i stop-loss bez emocji
13. MACRO CALENDAR — czy w ciągu 5 sesji jest decyzja Fed, CPI, PPI, NFP lub earnings tej spółki? Gap risk przy takim evencie niszczy R/R 1.67x → rekomenduj UNIKAJ lub drastycznie redukuj size`
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
12. REGUŁA SPRZEDAŻY O'NEIL — kiedy bezwarunkowo wychodzimy (-7-8% od wejścia lub specyficzne warunki)
13. EARNINGS RUN-UP — wyniki za 3-7 dni: czy historycznie spółka rośnie przed publikacją (earnings whisper)? Czy konsensus EPS rośnie? Jeśli tak: czyste momentum play — zaplanuj wyjście przed wynikami + tight stop`
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
12. RYZYKO SPECYFICZNE — 2-3 konkretne ryzyka dla tej spółki
13. ŚRODOWISKO MAKRO — faza cyklu stóp procentowych (rosnące = presja na growth/P/E, malejące = sprzyjające). Rotacja sektorowa instytucji: czy ten sektor jest w favor? Sezonowość: Q4 consumer/retail, Q1 tech capex, Q2 energetyka`
  }

  prompt += `\n\nDla "recommendation":\n- WEJDŹ/OBSERWUJ: KIEDY WEJŚĆ + PARAMETRY (Stop loss, Cel, Horyzont) + NASTĘPNY PRZEGLĄD\n- UNIKAJ: konkretny powód + kiedy warto wrócić\n- CEL ANALITYKÓW (priorytet NYSE): jeśli targetMeanPrice jest dostępny i targetUpside przekracza 2× domyślny cel strategii przy ≥60% rekomendacji Kup — używaj celu analityków jako nadrzędny benchmark take-profit. Zaproponuj: realizacja 50% na domyślnym celu strategii + trzymanie 50% do celu analityków. Stop loss strategii pozostaje NIEZMIENIONY.\n- suggestedTargetPct: gdy decision≠UNIKAJ — zwróć targetUpside jeśli analystBuy ≥60% i targetUpside dostępny; inaczej zwróć domyślny cel strategii (scalping=5, swing=15, aggressive=35). Zawsze liczba całkowita, nigdy null gdy WEJDŹ/OBSERWUJ.`

  const text = await callClaudeAPI(prompt, 2200)
  const parsed = parseJSON(text, {
    decision: 'OBSERWUJ', buffettScore: 5, compositeScore: null, signalStrength: null, confidence: 50,
    summary: 'Błąd AI — spróbuj ponownie.',
    analysis: 'Analiza niedostępna.',
    recommendation: 'Brak rekomendacji — spróbuj ponownie.',
    suggestedTargetPct: null,
  })
  parsed.suggestedTargetPct = clampSuggestedTarget(parsed.suggestedTargetPct, strategy)
  return parsed
}

// AI position evaluation — returns { action, confidence, reason, urgency, modification }
// strategy: 'scalping' → PTJ lens, 'aggressive' → O'Neil lens, 'swing' → Buffett/Lynch lens
export async function evaluatePosition({ ticker, exchange, signal, entryPrice, currentPrice, pnlPct, daysHeld, rsi, volMult, sma50Delta, stopLoss, target, trailingActive, news, fundamentals, priceAction = null, earningsDate = null, strategy = 'swing', avgEntryPrice = null, addedPositions = null, aiTargetRejected = null, aiStopRejected = null, holdStrength = null }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals, ticker)
  const defaultStop = DEFAULT_STOP[strategy] ?? 5
  const staticStop  = entryPrice && stopLoss  ? (entryPrice * (1 - stopLoss / 100)).toFixed(2)  : null
  const targetPrice = entryPrice && target     ? (entryPrice * (1 + target / 100)).toFixed(2)    : null
  const pnlNum      = Number(pnlPct)
  const nearTarget  = target > 0 && pnlNum >= target * 0.7

  let earningsLine = ''
  if (earningsDate) {
    const daysUntil = Math.ceil((new Date(earningsDate) - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysUntil >= 0 && daysUntil <= 7) {
      earningsLine = `\n- ⚠️ WYNIKI ZA ${daysUntil} DNI (${earningsDate}) — ryzyko luki cenowej przez noc`
    } else if (daysUntil > 7) {
      earningsLine = `\n- Najbliższe wyniki: ${earningsDate} (za ${daysUntil} dni)`
    }
  }

  const paWarningEval = priceAction && Math.abs(priceAction.change1d) >= 7
    ? ` ⚠️ GWAŁTOWNY RUCH — ryzyko korekty`
    : ''
  const priceActionLine = priceAction
    ? `\n- Zachowanie kursu: Zmiana 1 sesja: ${priceAction.change1d > 0 ? '+' : ''}${priceAction.change1d}%${paWarningEval} | Zmiana 5 sesji: ${priceAction.change5d > 0 ? '+' : ''}${priceAction.change5d}% | High vs Close ostatniej sesji: +${priceAction.highVsClose}%${priceAction.highVsClose >= 3 ? ' ⚠️ cena zamknięta daleko od szczytu — słabe zamknięcie' : ''}`
    : ''

  const stopBreached = !trailingActive && pnlNum < -defaultStop
  const effectiveEntry = avgEntryPrice ?? entryPrice
  const addedPositionsLine = addedPositions?.length
    ? `\n- Historia zwiększeń pozycji (${addedPositions.length}x): ${addedPositions.map(a => `${a.date} +${a.addedPct}% @ ${a.priceAtAdd}`).join(' | ')}`
    : ''
  const avgEntryLine = avgEntryPrice && Math.abs(avgEntryPrice - entryPrice) > 0.001
    ? ` (śr. cena wejścia po uśrednieniu: ${avgEntryPrice})`
    : ''

  const rejectionLines = [
    aiTargetRejected ? `\n- ⛔ Użytkownik odrzucił sugestię zmiany celu do +${aiTargetRejected.value}% (${aiTargetRejected.date}) — nie proponuj tej samej wartości ponownie` : '',
    aiStopRejected   ? `\n- ⛔ Użytkownik odrzucił sugestię zmiany stop loss do -${aiStopRejected.value}% (${aiStopRejected.date}) — nie proponuj tej samej wartości ponownie` : '',
  ].join('')

  const holdStrengthBlock = holdStrength
    ? `\nHOLD STRENGTH (wstępna diagnoza klienta — traktuj jako punkt wyjścia, nie wyrok):
Ogólny wynik: ${holdStrength.total}/100
- Efektywność (tempo do celu): ${holdStrength.dimensions.efficiency}/100
- Momentum RSI: ${holdStrength.dimensions.momentum}/100
- Integralność tezy (sygnał): ${holdStrength.dimensions.thesis}/100
- Jakość wejścia: ${holdStrength.dimensions.entryQuality}/100
- Historia AI: ${holdStrength.dimensions.aiHistory}/100
Interpretacja: ${holdStrength.total >= 70 ? 'MOCNA pozycja — teza działa' : holdStrength.total >= 40 ? 'SŁABNĄCA pozycja — wymagana uwaga' : 'SŁABA pozycja — rozważ wyjście'}`
    : ''

  const posBlock = `DANE POZYCJI:
- Ticker: ${ticker} (${exchange}) | Strategia: ${strategy} | Sygnał otwarcia: ${signal ?? 'brak'}
- Cena wejścia: ${entryPrice}${avgEntryLine} | Cena bieżąca: ${currentPrice} | P&L vs śr. cena: ${effectiveEntry > 0 ? `${((currentPrice - effectiveEntry) / effectiveEntry * 100).toFixed(1)}%` : `${pnlNum > 0 ? '+' : ''}${pnlNum}%`}
- Dni trzymania: ${daysHeld} | Stop: ${trailingActive ? 'trailing aktywny' : `${stopLoss}% (${staticStop})`} [domyślny strategii: ${defaultStop}%${stopBreached ? ' ⚠️ NARUSZONY' : ''}] | Cel: +${target}% (${targetPrice})${nearTarget ? ` ⚠️ BLISKO CELU` : ''}${addedPositionsLine}${rejectionLines}${earningsLine}${priceActionLine}

WSKAŹNIKI BIEŻĄCE:
- RSI: ${rsi} | Wolumen: ${volMult}x | vs SMA50: ${sma50Delta}%
${holdStrengthBlock}
FUNDAMENTY:
${fundBlock}

NEWSY:
${newsLines}`

  const jsonSchema = `Odpowiedz TYLKO w JSON bez markdown. compositeScore = siła tezy pozycji 0-100: fundamenty nadal obowiązują (40%) + stan techniczny (35%) + P&L vs cel/makro (25%). signalStrength: SŁABY (<40 — rozważ wyjście), UMIARKOWANY (40-54 — trzymaj ostrożnie), SILNY (55-74 — teza działa), BARDZO SILNY (≥75 — mocna pozycja).
{
  "action": "TRZYMAJ" | "ZAMKNIJ" | "ZMODYFIKUJ",
  "compositeScore": <0-100>,
  "signalStrength": "SŁABY" | "UMIARKOWANY" | "SILNY" | "BARDZO SILNY",
  "confidence": <0-100>,
  "reason": "<2-3 zdania PL: (1) czy teza nadal obowiązuje? (2) czy kupiłbyś tę spółkę DZISIAJ po obecnej cenie? (3) co zmieniło się od wejścia?>",
  "urgency": "NISKA" | "UMIARKOWANA" | "WYSOKA",
  "modification": "<ZAWSZE wypełnij: konkretny plan — stop loss, realizacja częściowa (jeśli blisko celu — rozważ sprzedaż 50%), co monitorować, następny przegląd>",
  "suggestedTargetPct": <liczba całkowita % od ceny WEJŚCIA lub null. Zmień cel TYLKO gdy fundBlock zawiera targetUpside ORAZ analystBuy ≥ 60% ORAZ cel analityków jest POWYŻEJ ceny bieżącej. Null gdy: action=ZAMKNIJ, brak danych analityków, konsensus Kup < 60% (nawet przy silnych fundamentach — słaby konsensus = brak podstaw do rewizji celu), cel analityków ≤ cenie bieżącej, lub zmiana byłaby < 3pp od obecnego celu>,
  "suggestedStopLossPct": <positive integer lub null — ZASADA: domyślny stop tej strategii to ${defaultStop}%, max dozwolony to ${defaultStop * 2}%. Zaproponuj szerszy stop TYLKO gdy WSZYSTKIE 4 warunki: (1) P&L przekroczył domyślny stop (⚠️ NARUSZONY widoczny wyżej), (2) fundamenty silne — EPS rośnie, ROE>15%, FCF yield>5% lub konsensus Kup≥60%, (3) teza inwestycyjna nadal obowiązuje tzn. kupiłbyś tę spółkę dzisiaj, (4) action=TRZYMAJ lub ZMODYFIKUJ. Null gdy: action=ZAMKNIJ z powodu fundamentalnego, fundamenty słabe/nieznane, stop nie naruszony, brak przekonujących podstaw do rozszerzenia>,
  "suggestedAddSizePct": <25 | 50 | 100 | null — % oryginalnej pozycji do dołożenia. Zaproponuj TYLKO gdy WSZYSTKIE 5 warunków: (1) strategia NIE jest scalping, (2) action=TRZYMAJ, (3) P&L między -${(defaultStop * 0.5).toFixed(0)}% a +${Math.round(target * 0.7 || 10)}% czyli nie blisko celu i nie przy głębokiej stracie, (4) fundamenty silne lub teza inwestycyjna przekonująca — kupiłbyś tę spółkę DZISIAJ, (5) daysHeld ≥ 2. Wybierz 25 gdy umiarkowane przekonanie, 50 gdy silne, 100 gdy bardzo silne (rzadko). Null gdy: scalping, action≠TRZYMAJ, głęboka strata lub blisko celu, fundamenty słabe, daysHeld < 2>,
  "addSizeExplanation": <string po polsku, 1 zdanie — ZAWSZE wypełnij dla swing, aggressive i long_term (nigdy null). Gdy suggestedAddSizePct != null: krótko DLACZEGO warto dokładać (np. "Silne fundamenty i niskie RSI uzasadniają zwiększenie ekspozycji"). Gdy suggestedAddSizePct = null: krótko DLACZEGO nie warto dokładać teraz (np. "Konsensus analityków słaby — tylko 30% Kup" / "Cena blisko celu — zbyt późno na dokładanie" / "Zbyt krótki holding — brak potwierdzenia tezy"). Null tylko dla scalping>,
  "longTermPerspective": <string po polsku max 2 zdania lub null — oceń TYLKO jeśli spółka ma silny fundament uzasadniający trzymanie 6-12 miesięcy niezależnie od horyzontu strategii (np. przyspieszający EPS, dominacja rynkowa, strukturalny wzrost popytu). Null jeśli brak przekonujących podstaw lub action=ZAMKNIJ>,
  "suggestedPartialExitPct": <25 | 50 | 75 | null — % pozycji do częściowej realizacji. Tylko informacyjnie. Zaproponuj TYLKO gdy WSZYSTKIE 4 warunki: (1) P&L ≥ ${defaultStop}% — TWARDY PRÓG MINIMALNY, poniżej tego prowizja + spread zjada zysk, (2) P&L ≥ 60% celu LUB ryzyko gwałtownie wzrosło (wyniki za ≤ 3 dni i P&L ≥ ${defaultStop}%), (3) strategia NIE jest scalping, (4) suggestedAddSizePct = null — ZAKAZ łączenia: jeśli sugerujesz zwiększenie pozycji, NIE możesz jednocześnie sugerować częściowego wyjścia — to sprzeczność logiczna; to samo dotyczy sytuacji gdy pozycja była zwiększana w ciągu ostatnich 5 dni (widoczne w historii zwiększeń). Wybierz: 25 gdy minimalna ostrożność, 50 gdy umiarkowane ryzyko, 75 gdy wysoki zysk lub wysokie ryzyko. Null gdy: P&L < ${defaultStop}%, action=ZAMKNIJ, scalping, suggestedAddSizePct != null, pozycja zwiększana w ostatnich 5 dniach>,
  "nextReviewDate": <string ISO "YYYY-MM-DD" — kiedy następny przegląd, licząc od DZISIAJ (${new Date().toISOString().slice(0, 10)}). Dla scalping: za 1-2 dni. Dla swing: za 5-10 dni. Dla aggressive: za 3-7 dni. Dla long_term: za 28-35 dni (miesięczny cykl). Dostosuj gdy: blisko wyniki spółki → dzień przed, blisko cel/stop → jutro>,
  "bullCase": <string po polsku, 1 zdanie — NAJWIĘKSZY argument ZA trzymaniem/dokładaniem. Konkretny (np. "EPS rośnie 25% r/r przy P/E 18x, spółka ma pricing power"). Zawsze wypełnij>,
  "bearCase": <string po polsku, 1 zdanie — NAJWIĘKSZE ryzyko dla pozycji. Konkretny (np. "Wyniki za 6 dni — luka cenowa może znieść cały zysk"). Zawsze wypełnij>
}`

  let persona
  if (strategy === 'scalping') {
    persona = `Jesteś traderem w stylu Paul Tudor Jones. Oceniasz krótkoterminową pozycję (target +5%, stop -3%, horyzont 2-5 dni). Twoja zasada: "Losers average losers" — jeśli setup jest zepsuty, wychodź natychmiast. Sprawdź: czy momentum nadal działa? R/R nadal korzystne? Czy trzymanie przez kolejny dzień ma sens?`
  } else if (strategy === 'aggressive') {
    persona = `Jesteś analitykiem w stylu William O'Neil. Oceniasz pozycję BREAKOUT (target +35%, stop -8%). Twoja zasada: "The whole secret to winning big in the stock market is not to be right all the time, but to lose the least amount possible when you're wrong." Sprawdź: czy wybicie nadal "działa poprawnie" (acting right)? Wolumen podtrzymuje ruch? Fundamenty (EPS) przyspieszyły czy zwolniły od wejścia?`
  } else if (strategy === 'long_term') {
    persona = `Jesteś analitykiem w stylu Warren Buffett i Charlie Munger. Oceniasz pozycję długoterminową (horyzont 6-18 miesięcy, stop -10%). Twoja zasada: "Our favorite holding period is forever — unless the fundamentals change." WAŻNE: ignoruj krótkoterminowy szum cenowy i techniczne wskaźniki momentum — liczy się siła fundamentalna. Sprawdź: (1) czy economic moat spółki pozostaje nienaruszone? (2) czy EPS i FCF rosną zgodnie z tezą? (3) czy wycena (P/E, EV/EBITDA) wciąż daje margin of safety przy 12-miesięcznej perspektywie? Krótkie korekty przy mocnych fundamentach to okazja do dokładania, nie powód do wyjścia. nextReviewDate ustaw za 28-35 dni (miesięczny cykl przeglądu).`
  } else {
    persona = `Jesteś seniorem analitykiem w stylu Buffett/Lynch. Oceniasz pozycję swing (target +15%, stop -5%, horyzont 4-8 tygodni). Buffett: "trzymaj aż zmienią się fundamenty, nie cena". Lynch: "sprzedaj gdy historia się kończy". Sprawdź integralność tezy: czy powód dla którego wszedłeś nadal obowiązuje?`
  }

  const prompt = `${persona}

${posBlock}

${jsonSchema}`

  const text = await callClaudeAPI(prompt, 1200)
  const parsed = parseJSON(text, { action: 'TRZYMAJ', compositeScore: null, signalStrength: null, confidence: 50, reason: 'Błąd AI.', urgency: 'NISKA', modification: 'Brak rekomendacji — spróbuj ponownie.', suggestedTargetPct: null, suggestedStopLossPct: null, suggestedAddSizePct: null, addSizeExplanation: null, longTermPerspective: null, suggestedPartialExitPct: null, nextReviewDate: null, bullCase: null, bearCase: null })
  parsed.suggestedTargetPct   = clampSuggestedTarget(parsed.suggestedTargetPct, strategy)
  parsed.suggestedStopLossPct = clampSuggestedStopLoss(parsed.suggestedStopLossPct, strategy)
  parsed.suggestedAddSizePct  = clampSuggestedAddSize(parsed.suggestedAddSizePct, strategy)
  if (strategy === 'scalping') parsed.addSizeExplanation = null
  const ALLOWED_PARTIAL = [25, 50, 75]
  if (parsed.suggestedPartialExitPct != null) {
    const closest = ALLOWED_PARTIAL.reduce((a, b) => Math.abs(b - parsed.suggestedPartialExitPct) < Math.abs(a - parsed.suggestedPartialExitPct) ? b : a)
    parsed.suggestedPartialExitPct = closest
  }
  if (parsed.nextReviewDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.nextReviewDate)) {
    parsed.nextReviewDate = null
  }
  return parsed
}

// AI horizon review — called when position nears end of strategy horizon
// Returns { tacticalOption, longTermOption, strategyUpgradeOption }
export async function evaluateHorizon({ ticker, exchange, signal, strategy, daysHeld, entryPrice, currentPrice, pnlPct, target, stopLoss, fundamentals, news }) {
  const newsLines = news?.length
    ? news.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'Brak nagłówków'
  const fundBlock = buildFundBlock(fundamentals, ticker)
  const today = new Date().toISOString().slice(0, 10)
  const addDays = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

  const dataBlock = `DANE POZYCJI:
- Ticker: ${ticker} (${exchange}) | Strategia: ${strategy} | Sygnał: ${signal ?? 'brak'}
- Cena wejścia: ${entryPrice} | Cena bieżąca: ${currentPrice} | P&L: ${pnlPct > 0 ? '+' : ''}${pnlPct}%
- Dni trzymania: ${daysHeld} | Cel: +${target}% | Stop: -${stopLoss}%
- Dzisiaj: ${today}

FUNDAMENTY:
${fundBlock}

NEWSY:
${newsLines}`

  const upgradeInfo = strategy === 'scalping'
    ? 'Strategia: SCALPING (cel +5%, stop -3%, horyzont 2-5 dni). Upgrade do swing = cel +15%, stop -5%, horyzont 4-8 tygodni.'
    : strategy === 'swing'
    ? 'Strategia: SWING (cel +15%, stop -5%, horyzont 4-8 tygodni). Upgrade do aggressive = cel +25-35%, stop -8%, horyzont 4-12 tygodni.'
    : 'Strategia: AGGRESSIVE (cel +35%, stop -8%). Brak opcji upgrade — to najszersza strategia.'

  const prompt = `Jesteś doradcą inwestycyjnym oceniającym co zrobić z pozycją po zbliżeniu się do końca horyzontu. Pozycja nadal otwarta — użytkownik rozważa kontynuację.

${dataBlock}

${upgradeInfo}

Zaproponuj TRZY niezależne opcje. Oceniaj realistycznie — nie wszystkie muszą być "applicable: true". Odpowiedz TYLKO w JSON bez markdown:

{
  "tacticalOption": {
    "weeks": <integer 1-6 — ile tygodni przedłużenia w ramach tej samej strategii>,
    "newTarget": <integer % od ceny wejścia — nowy lub taki sam cel>,
    "checkpoint": "<YYYY-MM-DD — data wymuszonego przeglądu>",
    "rationale": "<2-3 zdania PL: dlaczego warto przedłużyć? Co konkretnie monitorować?>"
  },
  "longTermOption": {
    "applicable": <true jeśli fundamenty uzasadniają 6-18 mcy: silny EPS, moat, strukturalny wzrost | false jeśli spekulacja lub brak danych>,
    "months": <integer 6-18 lub null>,
    "newTarget": <integer % od ceny wejścia lub null>,
    "nextCheckpoint": "<YYYY-MM-DD — przegląd za ~30 dni lub null>",
    "rationale": "<2-3 zdania PL: czy fundamenty uzasadniają długoterminowe trzymanie? Główne ryzyka?>"
  },
  "strategyUpgradeOption": {
    "applicable": <true TYLKO gdy strategia to scalping lub swing i fundamenty są mocne lub trend wyraźny | false dla aggressive lub gdy brak podstaw>,
    "upgradeTo": <"swing" gdy strategia=scalping | "aggressive" gdy strategia=swing | null>,
    "newTarget": <integer % od ceny wejścia lub null>,
    "newStopLoss": <integer % — szerszy stop dopasowany do nowej strategii lub null>,
    "checkpoint": "<YYYY-MM-DD lub null>",
    "rationale": "<2-3 zdania PL: czy upgrade jest uzasadniony? Jakie warunki muszą być spełnione?>"
  }
}`

  const text = await callClaudeAPI(prompt, 800)
  return parseJSON(text, {
    tacticalOption: { weeks: 2, newTarget: target, checkpoint: addDays(14), rationale: 'Brak danych — spróbuj ponownie.' },
    longTermOption: { applicable: false, months: null, newTarget: null, nextCheckpoint: null, rationale: 'Analiza niedostępna.' },
    strategyUpgradeOption: { applicable: false, upgradeTo: null, newTarget: null, newStopLoss: null, checkpoint: null, rationale: 'Analiza niedostępna.' },
  })
}
