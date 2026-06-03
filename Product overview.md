# GPW Analyzer — Product Overview

> Wersja dokumentu: v1.36.6 · Ostatnia aktualizacja: 2026-05-29

---

## 1. Introduction

GPW Analyzer to edukacyjna aplikacja giełdowa monitorująca rynki **GPW (Polska)** i **NYSE (USA)**. Cel produktu: automatyczne wykrywanie sygnałów technicznych, wysyłanie alertów przez Telegram i uczenie się na podstawie historycznych wyników rekomendacji.

**Kluczowe właściwości:**
- Trzy strategie inwestycyjne (scalping, swing, agresywna) z oddzielnymi universa spółek dla GPW i NYSE
- Scoring wieloczynnikowy (0–100 pkt) agregujący 9 wskaźników technicznych i makroekonomicznych
- Dynamiczne zarządzanie ryzykiem: position sizing wg score, trailing stop, ekspozycja sektorowa
- Learning Agent — tygodniowa korekta progów RSI/wolumenu na podstawie historycznych wyników
- Backtesting 5-letni z pełnym zestawem metryk statystycznych i eksportem CSV
- AI walidacja wejść i ocena pozycji (framework per strategia: PTJ / O'Neil / Buffett-Lynch)
- Per-pozycyjny chat AI z pełnym kontekstem wskaźników, newsów i dni trzymania
- Środowiska PROD i STAGING z oddzielnymi botami Telegram

**Czego aplikacja NIE robi:**
- Nie wykonuje zleceń (brak integracji z brokerem)
- Nie przetwarza danych real-time (dane z Yahoo Finance, min. 15 min opóźnienia podczas sesji)
- Nie zarządza rachunkiem — wyniki są edukacyjne, nie stanowią rekomendacji inwestycyjnych

---

## 2. Architecture Overview

### 2.1 Stack technologiczny

| Warstwa | Technologia | Rola |
|---|---|---|
| Frontend | React 18 + Vite 5 + Tailwind CSS | SPA, 6 zakładek, Recharts |
| Backend | Vercel Serverless Functions (Node.js ESM) | API, cron jobs |
| Baza danych | Vercel KV (Upstash Redis) | Alerty, pozycje, progi, cache |
| AI | Anthropic Claude API (`claude-sonnet-4-6`) | Chat, walidacja wejść, ocena pozycji, Learning Agent |
| Powiadomienia | Telegram Bot API | Alerty sygnałów, monitoring pozycji |
| Hosting | Vercel | PROD + STAGING |
| Dane rynkowe | Yahoo Finance v8 API | OHLCV 1y / 5y + `regularMarketPrice` (live) |
| Dane GPW | Stooq.pl | Świeczki GPW (primary), Yahoo jako fallback |
| Dane NYSE | Yahoo Finance v8 API | Świeczki NYSE (TwelveData usunięty — zwracał stałe dane EOD) |
| Dane macro PL | NBP XML Archive + Eurostat HICP | Stopa ref. + CPI |
| Dane macro US | FRED (Fed + CPI) | Stopa Fed + CPI USA |
| Newsy | Yahoo Finance RSS | Headlines per ticker (KV cache 2h) |

### 2.2 Ceny: sygnał vs live

Sygnały są generowane na podstawie dziennych świec (OHLCV), które aktualizują się po zamknięciu sesji. Cena w sygnale (`price`) to ostatnia dzienna zamknięcie — używana do obliczeń wskaźników (RSI, SMA, MACD).

Oddzielnie pobierana jest cena live (`livePrice = regularMarketPrice`) bezpośrednio z Yahoo Finance meta, omijając KV cache. Jest używana do:
- Wyświetlania aktualnej ceny w karcie sygnału
- Kalkulatora pozycji (shares, P&L)
- ConfirmTradeModal (cena zakupu)
- Ostrzeżenia o spóźnionym sygnale (gdy drift ≥ 5%)

### 2.3 Flow danych — skanowanie sygnałów

```
Vercel Cron (harmonogram UTC)
       │
       ▼
api/cron/fetch.js
       │
       ├─► kv.get(thresholds)          ← progi Learning Agenta
       ├─► fetchIndexTrend(exchange)   ← trend WIG20/S&P500
       ├─► kv.get(settings)            ← portfolio, maxPositionPct
       ├─► kv.keys(position:*)         ← otwarte pozycje
       ├─► getMacroEnvironment()       ← NBP+Eurostat lub FRED (cache 24h KV)
       └─► kv.get(seasonality:*)       ← historyczne zwroty miesięczne
              │
              ▼
    dla każdego tickera z universe (batch po 10):
       │
       ├─► getCachedData(ticker)       ← Stooq/Yahoo (cache 8h NYSE / 4h GPW w KV)
       ├─► detectSignal(candles, ...)  ← 9 wskaźników → signal + score
       │
       │   jeśli sygnał:
       ├─► macro adjustment            ← adjustedScore = score + macro.scoreAdjustment
       ├─► checkSectorExposure()       ← blok / redukcja 50% / ok
       ├─► calcPositionSize()          ← blocked / 50% / 75% / 100% bazy
       ├─► calcDynamicTarget()         ← cel z historii lub default
       ├─► calcDynamicHorizon()        ← horyzont z historii lub default
       │
       └─► sendTelegram(alert)         ← format HTML na Telegram
           kv.set(alert:*)            ← TTL 90 dni
```

### 2.4 Flow danych — monitoring pozycji

```
Vercel Cron (pon-pt 15:50 UTC)
       │
api/cron/positions-monitor.js
       │
       ├─► kv.keys(position:*)        ← wszystkie otwarte pozycje
       ├─► fetchCurrent(ticker)       ← aktualna cena z Yahoo
       │
       dla każdej pozycji:
       ├─► P&L% = (price - entry) / entry * 100
       ├─► trailing stop update       ← highWaterMark, break-even
       ├─► alert "CEL BLISKO"        ← P&L ≥ 80% celu (dedup 23h KV)
       ├─► alert "STOP LOSS BLISKO"  ← P&L ≤ -80% stopu (dedup 23h KV)
       └─► alert "HORYZONT"          ← dni > maxDays (dedup 23h KV)
```

### 2.5 Środowiska i CI/CD

```
GitHub (main branch) ──► Vercel PROD  ──► gpw-analyzer.vercel.app
GitHub (staging branch) ─► Vercel STAGING ─► gpw-analyzer-staging.vercel.app
```

Klucze KV rozdzielone prefiksem: `prod:*` vs `staging:*`. Osobne boty Telegram (PROD / STAGING).

---

## 3. Feature Deep Dive

### 3.1 Wskaźniki techniczne — implementacja i parametry

#### RSI (Relative Strength Index)
- **Implementacja:** Wilder's Smoothed EMA
- **Okres:** 9 dni (scalping) lub 14 dni (swing/aggressive)
- **Wymagane dane:** min. 15 świec

**Progi strategii:**
| Strategia | Próg | Kierunek |
|---|---|---|
| Scalping GPW | RSI < 28 | Wyprzedanie (sygnał kupna) |
| Scalping NYSE | RSI < 28 | Wyprzedanie |
| Agresywna GPW/NYSE | RSI 60–70 | Impuls wzrostowy (breakout) |

Progi korygowane przez Learning Agenta — przechowywane w KV pod `prod:thresholds`.

---

#### SMA (Simple Moving Average)

Dostępne okresy: SMA20, SMA50, SMA150.

**Zastosowania strategii:**
| Wskaźnik | Strategia | Rola |
|---|---|---|
| `price > SMA150` | Scalping + Swing | Filtr trendu — brak sygnału poniżej SMA150 |
| `price crosses SMA50 (↑)` | Swing | Trigger sygnału (okno 3 dni) |
| `SMA20 > SMA50` (golden cross) | Swing | Alternatywny trigger |
| SMA150 przy Aggressive | Brak filtra | Tylko ostrzeżenie `sma150Warning` |

---

#### Volume Multiplier

```
avgVolume = średnia z ostatnich 20 dni
volumeMultiplier = volume_today / avgVolume
```

**Minimalne progi:**
| Strategia | GPW | NYSE |
|---|---|---|
| Scalping | 1.5x | 1.15x |
| Swing | 1.2x | 1.3x |
| Agresywna | 2.5x | 1.5x |

---

#### ATR (Average True Range)

**Dynamiczny stop loss:**
| Strategia | Mnożnik ATR | Min stop | Max stop |
|---|---|---|---|
| Scalping | 1.0× | 1.5% | 5.0% |
| Swing | 1.5× | 3.0% | 8.0% |
| Agresywna | 2.0× | 5.0% | 15.0% |

---

#### MACD, Bollinger Bands, RSI Divergence, Support Proximity, Seasonality, Index Trend

Szczegóły implementacji niezmienione — patrz commit history. Scoring łączny: max 130 pkt → normalizowany do 100.

---

### 3.2 Scoring — agregacja wieloczynnikowa

| Składnik | Maks pkt |
|---|---|
| RSI | 25 |
| Volume | 20 |
| SMA150 trend | 15 |
| Bollinger | ±20 |
| MACD | ±15 |
| Index trend | 10 |
| Seasonality | ±10 |
| Support proximity | 5 |
| RSI Divergence | 5 |

```
score = clamp(round(rawScore / 130 × 100), 0, 100)
adjustedScore = score + macro.scoreAdjustment
```

**Korekta makro:** NEUTRALNE 0 / UWAGA −10 / RYZYKOWNE −25.

---

### 3.3 AI Analysis Framework

Każda strategia ma przypisany osobny framework analityczny wywołany przy "Waliduj z AI":

| Strategia | Framework | Opis |
|---|---|---|
| Scalping | **Paul Tudor Jones (PTJ)** | 5-punktowy checklist: risk/reward ≥ 3:1, wolumen, ATR stop, trend rynku, czytelność setupu |
| Aggressive | **William O'Neil (CANSLIM)** | 7 punktów: Earnings, Annual growth, New catalyst, Supply/demand, Leader, Institutional, Market direction |
| Swing | **Buffett / Lynch** | 12-punktowa analiza fundamentalna: moat, FCF, ROE, PEG, margin of safety, rekomendacje instytucjonalne |

> **Uwaga:** CANSLIM zaprojektowany jest dokładnie pod breakouty z wolumenem — C/S/M bezpośrednio pokrywają warunki sygnału agresywnego.

**Kontekst ceny w walidacji:**
- Do promptu AI trafia `signalPrice` (cena z candles) + `livePrice` (aktualny `regularMarketPrice`)
- Gdy drift ≥ 5%: AI dostaje ostrzeżenie `⚠️ CENA ODESZŁA OD SYGNAŁU` i uwzględnia to w margin of safety

**Ocena otwartych pozycji (`mode=ai-evaluate`):**
- Framework: analiza "czy kupiłbym dziś po tej cenie?"
- Kontekst: cena wejścia, cena aktualna, P&L%, dni trzymania, RSI, wolumen, stop/target, newsy, fundamenty
- Output: `action` (TRZYMAJ / ZAMKNIJ / DODAJ), `confidence`, `reason`, `urgency`, `modification`

---

### 3.4 Per-pozycyjny Chat AI (Moje wyniki)

Każda otwarta pozycja ma własny chat z Claude AI w zakładce Moje wyniki:
- Historia czatu persystowana w `localStorage` (`chat_pos_${id}`)
- Przed pierwszą wiadomością: lazy fetch wskaźników (`mode=indicators`) + newsów (`mode=news`) w parallel
- System prompt zawiera: ticker, strategia, cena wejścia, P&L, dni trzymania, RSI, wolumen, SMA, MACD, Bollinger, score, newsy, wynik "Oceń z AI" (jeśli dostępny)
- AI instruowane żeby używać tych danych bezpośrednio, nie prosić użytkownika o sprawdzenie

---

### 3.5 Ostrzeżenie o spóźnionym sygnale

Gdy `|livePrice - signalPrice| / signalPrice ≥ 5%`:
- Żółty banner na karcie sygnału: "⚠️ Cena odeszła +X% od sygnału (84.84 → 93.23) — breakout mógł już się wyczerpać"
- Modal walidacji pokazuje: `93.23 zam. 84.84 USD`
- AI prompt zawiera ostrzeżenie o dryfcie i uwzględnia je w ocenie

---

### 3.6 Position Sizing

| Warunek | Efekt |
|---|---|
| `adjustedScore < 60` | Blokada |
| `portfolioDrawdown > 15%` | Blokada |
| `totalExposure > 60%` | Blokada |
| `score ≥ 80` | 100% bazy |
| `score 70–79` | 75% bazy |
| `score 60–69` | 50% bazy |

Ekspozycja sektorowa: 2+ pozycje w sektorze → blokada; 1 pozycja → `effectiveMaxPct × 0.5`.

Kalkulator pozycji w UI używa `livePrice` (nie `signalPrice`) do przeliczenia shares i wartości pozycji.

---

### 3.7 Trailing Stop

```
trailingStop = highWaterMark × (1 - stopPct)
breakEven = entryPrice  (gdy P&L ≥ 50% celu)
effectiveStop = max(trailingStop, breakEven)
```

---

### 3.8 Backtesting Engine

Symulacja krocząca na 5 latach danych Yahoo Finance. Metryki: winRate, avgGain, profit_factor, Sharpe ratio, maxDrawdown, year breakdown, equity curve. Cache KV 30 dni.

---

### 3.9 Learning Agent

Uruchamiany co niedzielę 18:00 UTC. Analizuje 30 dni alertów, wysyła do Claude API, koryguje progi RSI/wolumenu, zapisuje w KV, tworzy GitHub Issue, wysyła raport Telegram.

---

### 3.10 Macro Filter

**GPW:** NBP stopa ref. + Eurostat HICP (CPI PL)
**NYSE:** FRED FEDFUNDS + FRED CPIAUCSL
Cache KV 24h.

---

## 4. Configuration & Setup

### 4.1 Zmienne środowiskowe

| Zmienna | Wymagana | Opis |
|---|---|---|
| `ANTHROPIC_API_KEY` | Tak | Claude API — chat, walidacja, Learning Agent |
| `TELEGRAM_BOT_TOKEN` | Tak | Bot PROD |
| `TELEGRAM_CHAT_ID` | Tak | Chat ID PROD |
| `TELEGRAM_BOT_TOKEN_STAGING` | Tak | Bot STAGING |
| `TELEGRAM_CHAT_ID_STAGING` | Tak | Chat ID STAGING |
| `CRON_SECRET` | Tak | Bearer token chroniący endpointy cron |
| `KV_REST_API_URL` | Tak | Automatycznie przez Vercel KV |
| `KV_REST_API_TOKEN` | Tak | Automatycznie przez Vercel KV |
| `EODHD_API_KEY` | Nie | P/E i dywidendy GPW (max 10 req/dzień) |
| `VITE_ENV` | Nie | `staging` dla staging; brak = prod |

### 4.2 Komendy

```bash
npm run dev             # dev server localhost:5173
npm run build           # build produkcyjny
npm run lint            # ESLint
npm run test            # Vitest watch
npm run test:coverage   # Vitest + coverage report

vercel --yes            # deploy STAGING
vercel --prod --yes     # deploy PROD (tylko za zgodą Adama)
```

### 4.3 Workflow

```bash
# Standardowy cykl:
git checkout staging
# ...zmiany...
git add <pliki>
git commit -m "feat/fix #N: opis"
git push origin staging
# → QA → zgoda Adama
git checkout main && git merge staging --no-ff
git push origin main && git checkout staging
vercel --prod --yes
```

### 4.4 Cron Jobs (harmonogram UTC)

| Czas UTC | Endpoint | Opis |
|---|---|---|
| pon–pt 09:05 | `fetch?strategy=scalping` | GPW scalping — otwarcie |
| pon–pt 12:00 | `fetch?strategy=scalping&slot=mid` | GPW scalping — południe |
| pon–pt 14:45 | `fetch?strategy=scalping&slot=pre` | GPW scalping — przed zamknięciem |
| pon–pt 15:35 | `fetch?strategy=swing` | GPW swing |
| pon–pt 15:40 | `fetch?strategy=aggressive` | GPW agresywna |
| pon–pt 19:35 | `fetch?strategy=scalping&exchange=NYSE` | NYSE scalping (13:35 ET) |
| pon–pt 20:10 | `fetch?strategy=swing&exchange=NYSE` | NYSE swing |
| pon–pt 20:15 | `fetch?strategy=aggressive&exchange=NYSE` | NYSE agresywna |
| pon–pt 15:50 | `positions-monitor` | P&L, trailing stop, horyzont |
| niedziela 18:00 | `learning-weekly` | Learning Agent |

---

## 5. User Manual

### 5.1 Dashboard

- Karty indeksów (WIG20/mWIG40/sWIG80 lub S&P500/NASDAQ/DJI)
- Wykres % zmian (normalizowany, max 3 spółki)
- Karty makroekonomiczne: Rate / CPI / Status
- Ostatnie 3 alerty z KV

### 5.2 Strategie

**Sygnały** — aktywne rekomendacje z cron:
- Karta sygnału: cena live (+ `zam. X` gdy drift), RSI, wolumen, SMA, ATR, MACD, Bollinger, score, cel, stop
- Ostrzeżenie żółte gdy cena odeszła ≥5% od sygnału
- "📖 Co robić?" → interpretacja sygnału
- "🤖 Waliduj z AI" → analiza PTJ / CANSLIM / Buffett-Lynch zależnie od strategii
- "+ Otwórz pozycję" → ConfirmTradeModal (cena domyślna = livePrice + prowizja)

**Scan** — pełny universe z wskaźnikami, posortowany wg score.

**Top RSI** — spółki z najniższym (scalping) lub najwyższym (aggressive) RSI.

### 5.3 Moje wyniki

**Otwarte pozycje:**
- P&L% live, pasek postępu do celu, stop loss (stały lub trailing)
- Score przy wejściu → aktualny score z deltą (↑↓)
- "Oceń z AI" → ocena pozycji: TRZYMAJ / ZAMKNIJ / DODAJ
- "💬 Porozmawiaj z AI" → per-pozycyjny chat z pełnym kontekstem wskaźników + newsów
- Zamknij pozycję → dialog z ceną wyjścia → P&L zapisany w KV

**Zamknięte pozycje:** historia z P&L% i P&L PLN/USD.

### 5.4 Historia alertów

Lista alertów z KV. Filtry: strategia, ticker, limit.

### 5.5 Backtest

Ticker + strategia → symulacja 5 lat → winRate, avgGain, Sharpe, equity curve, tabela transakcji, CSV export.

### 5.6 Ustawienia

| Pole | Domyślnie |
|---|---|
| Wartość portfela | 10 000 PLN/USD |
| Max pozycja % | 15% |
| Prowizja % | 0.38% |

---

## 6. API Reference

### GET `/api/market`

Parametr `mode`:

| Mode | Opis |
|---|---|
| `daily` | Tablica OHLCV dla tickera (cache 25 min) |
| `current` | `regularMarketPrice` live (cache 5 min) |
| `indicators` | Pełne wskaźniki dla tickera: RSI, SMA, MACD, Bollinger, score |
| `news` | Headlines RSS Yahoo Finance (cache KV 2h) |
| `signals` | Aktywne sygnały z universe, z `livePrice` |
| `scan` | Pełny universe z wskaźnikami, `hasSignal` + score sort |
| `macro` | Rate + CPI + status (cache KV 24h) |
| `backtest` | Symulacja 5-letnia (cache KV 30 dni) |
| `ai-validate` | Walidacja wejścia AI (PTJ/CANSLIM/Buffett-Lynch per strategia) |
| `ai-evaluate` | Ocena otwartej pozycji AI |
| `gem-decision` | Decyzja GEM (Global Equity Momentum) |

**Parametry `ai-validate`:**

| Param | Opis |
|---|---|
| `ticker`, `exchange` | Identyfikator spółki |
| `strategy` | scalping / swing / aggressive (wybiera framework AI) |
| `signal`, `score`, `rsi`, `volMult`, `sma50Delta` | Dane techniczne |
| `signalPrice` | Cena z candles (do obliczeń wskaźników) |
| `livePrice` | Aktualna cena rynkowa (do oceny margin of safety) |

---

### POST `/api/chat`

Chat z Claude AI.

```json
{ "messages": [...], "system": "<opcjonalny override system prompt>" }
```

System prompt override używany przez per-pozycyjny chat (zawiera kontekst pozycji + wskaźniki + newsy).

---

### GET `/api/positions`, `POST`, `PATCH`

Zarządzanie portfelem. `PATCH` zamyka pozycję z `exitPrice`, oblicza P&L i czyści localStorage czatu.

---

### GET `/api/alerts`

```
GET /api/alerts?limit=20&strategy=scalping&ticker=PKN
```

---

## 7. Backlog (wybrane issue)

| # | Tytuł | Priorytet |
|---|---|---|
| #107 | ai-validate prompt per strategia (PTJ / O'Neil / Buffett-Lynch) | P2 |
| #108 | Wzmocnienie ai-evaluate dla otwartych pozycji | P2 |
| #105 | Wyszukiwarka tickera w Strategiach | P2 |
| #104 | "Sprawdź ponownie" na zamkniętych pozycjach — re-entry flow | P2 |
| #103 | Intraday volume w mode=indicators | P3 |
| #100–102 | Długoterminowe tab UX (GEM price, ETF/DCA, Dywidendowe AI) | P2 |
| #99 | BREAKOUT verdict za agresywny (bufor daysHeld + pnl%) | P2 |
| #98 | Peak drawdown alert w positions-monitor | P3 |

---

*Dokument odzwierciedla stan produkcyjny v1.36.6 z dnia 2026-05-29.*
