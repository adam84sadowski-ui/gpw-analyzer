# GPW Analyzer — Instrukcja dla Agentów Claude

## Cel projektu
Edukacyjny asystent giełdowy analizujący GPW (Polska) i NYSE (USA).
Wykrywa sygnały techniczne, wysyła alerty na Telegram, uczy się
na podstawie wyników poprzednich rekomendacji.

---

## Stack technologiczny

| Warstwa | Technologia |
|---------|-------------|
| Frontend | React 18, Vite 5, Tailwind CSS, Recharts |
| Backend | Vercel Serverless Functions (Node.js, ES modules) |
| Baza danych | Vercel KV (Upstash Redis) |
| Harmonogram | Vercel Cron Jobs |
| Dane rynkowe | Yahoo Finance (proxy), EODHD |
| AI | Anthropic Claude API (`claude-sonnet-4-6`) |
| Powiadomienia | Telegram Bot API |
| Hosting | Vercel (PROD + STAGING) |
| CI/CD | GitHub Actions |

Język: **JavaScript (ESM)**. Brak TypeScript. Brak backendu poza Vercel Functions.

---

## Środowiska

| Środowisko | URL | Gałąź |
|------------|-----|--------|
| PROD | https://gpw-analyzer.vercel.app | `main` |
| STAGING | https://gpw-analyzer-staging.vercel.app | `staging` |
| GitHub | https://github.com/adam84sadowski-ui/gpw-analyzer | — |

---

## Zmienne środowiskowe

Zawsze używaj `.env` lokalnie i Vercel Dashboard na serwerze. **Nigdy nie hardcoduj kluczy.**

```
ANTHROPIC_API_KEY=           # Claude API (chat + Learning Agent)
EODHD_API_KEY=               # EODHD: P/E ratio i dywidendy, max 10 req/dzień
TELEGRAM_BOT_TOKEN=          # Bot PROD
TELEGRAM_CHAT_ID=            # Chat ID PROD
TELEGRAM_BOT_TOKEN_STAGING=  # Bot STAGING (osobny bot)
TELEGRAM_CHAT_ID_STAGING=    # Chat ID STAGING
VERCEL_TOKEN=                # Vercel CLI deploy
CRON_SECRET=                 # Bearer token autoryzacji cron endpointów
VITE_ENV=staging             # "staging" | brak (prod wykrywa przez brak)
KV_REST_API_URL=             # Dodawane auto przez Vercel KV
KV_REST_API_TOKEN=           # Dodawane auto przez Vercel KV
```

Wykrywanie środowiska w API:
```js
const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV = IS_STAGING ? 'staging' : 'prod'   // prefiks kluczy KV
```

---

## Komendy

```bash
cd projects/gpw-analyzer
npm run dev          # lokalny dev server (Vite HMR, port 5173)
npm run build        # build produkcyjny → dist/
npm run lint         # ESLint (tylko eslint-plugin-react — UWAGA niżej)
vercel --yes         # deploy STAGING
vercel --prod --yes  # deploy PROD (tylko za zgodą Adama!)
```

---

## Struktura projektu

```
gpw-analyzer/
├── api/                          # Vercel Serverless Functions
│   ├── alerts.js                 # GET /api/alerts — lista alertów z KV
│   ├── chat.js                   # POST /api/chat — chat window (Claude API)
│   ├── claude.js                 # POST /api/claude — helper Claude API
│   ├── eodhd.js                  # GET /api/eodhd?ticker= — P/E, dywidendy
│   ├── kv.js                     # GET/POST /api/kv — debug KV (staging only)
│   ├── market.js                 # GET /api/market — dane rynkowe, scan, signals
│   ├── positions.js              # GET/POST/PATCH /api/positions — portfel
│   ├── telegram-webhook.js       # POST /api/telegram-webhook — komendy bota
│   └── cron/
│       ├── fetch.js              # Cron: skanowanie strategii, wysyłka alertów
│       ├── learning-weekly.js    # Cron: tygodniowy raport Learning Agenta
│       ├── positions-monitor.js  # Cron: monitoring otwartych pozycji
│       └── trigger.js            # POST (staging only): ręczne wyzwolenie crona
├── src/
│   ├── components/
│   │   ├── Alerts/Alerts.jsx     # Zakładka: historia alertów z KV
│   │   ├── Dashboard/Dashboard.jsx  # Zakładka: indeksy, wykres % zmian, alerty
│   │   ├── Results/Results.jsx   # Zakładka: otwarte/zamknięte pozycje + P&L
│   │   ├── Strategies/Strategies.jsx # Zakładka: sygnały, Top RSI, scan, "📖 Co robić?"
│   │   ├── Chat/                 # Chat window z Claude API
│   │   ├── ExchangeSwitcher/     # Przełącznik GPW ↔ NYSE
│   │   ├── Settings/             # Ustawienia portfela
│   │   └── Portfolio/            # Podsumowanie portfela
│   ├── context/
│   │   └── ExchangeContext.jsx   # Globalny stan: exchange, currency, timezone, flag, label
│   ├── lib/
│   │   ├── interpretSignal.js    # interpretSignal(signal, values, strategy) → { text, warnings, positives, horizon }
│   │   ├── signals.js            # detectSignal(), calcIndicators() — logika sygnałów
│   │   └── yahoo.js              # fetchCandles(), fetchCurrent(), toYahooSymbol()
│   ├── services/
│   │   ├── telegram.js           # sendTelegram(), formatAlert()
│   │   ├── claude.js             # wywołania Claude API
│   │   ├── eodhd.js              # klient EODHD
│   │   ├── stooq.js              # fetchDaily(), fetchIndex() — wrapper Yahoo Finance
│   │   └── cache.js              # in-memory cache (25 min TTL)
│   └── strategies/
│       ├── scalping.js           # SCALPING_DEFAULTS
│       ├── swing.js              # SWING_DEFAULTS
│       └── aggressive.js        # AGGRESSIVE_DEFAULTS
└── vercel.json                   # Cron schedule + rewrites
```

---

## Źródła danych

### Yahoo Finance (główne dane OHLCV)
- Proxy przez `/api/market` i `src/lib/yahoo.js` — **nigdy nie odpytuj z przeglądarki (CORS)**
- Ticker GPW (wewnętrzny): suffix `.pl` → konwersja do Yahoo: `.WA` (np. `pkn.pl` → `PKN.WA`)
- Ticker NYSE: bez sufiksu (`AMD`, `AAPL`, `TSLA`)
- Funkcja konwersji: `toYahooSymbol(ticker, exchange)` w `src/lib/yahoo.js`
- Zakres: `range=1y` (252 dni) — wymagane do RSI(14) i SMA50

### EODHD
- P/E ratio i dywidendy (tylko GPW)
- Max 10 requestów dziennie — ładuj tylko dla spółek z sygnałem
- Endpoint: `/api/eodhd?ticker=pkn.pl`

### Telegram Bot API
- Wysyłka przez `src/services/telegram.js → sendTelegram(msg, isStaging)`
- PROD i STAGING mają osobne boty i chat ID
- Format: HTML (`parse_mode: 'HTML'`)

### Claude API (`claude-sonnet-4-6`)
- Chat window: `/api/chat`
- Learning Agent: `/api/cron/learning-weekly`

---

## Wskaźniki techniczne

### RSI (Relative Strength Index)
- Implementacja: Wilder's smoothed EMA, `calcRSI(closes, period=14)` w `src/lib/signals.js`
- Wejście: tablica `close` z ostatnich 252 dni
- Zwraca `null` jeśli za mało danych

### SMA (Simple Moving Average)
- `calcSMA(closes, period)` — ostatnia wartość
- `calcSMASeries(closes, period)` — pełna seria
- `goldenCross(closes)` — SMA20 > SMA50 w dowolnym z ostatnich 3 dni

### Volume Multiplier
- `volumeMultiplier(volumes)` — bieżący wolumen / średnia z 20 dni
- Zwraca `null` jeśli za mało danych

### Breakout
- `isBreakout(candles)` — cena > max z ostatnich 20 dni (przy min. 21 świecach)

---

## Strategie i universa spółek

Każda strategia ma osobne universum dla GPW i NYSE. **Oba miejsca muszą być zsynchronizowane:**
- `api/cron/fetch.js` → `STRATEGY_CONFIG[strategy].universe.GPW/NYSE`
- `api/cron/trigger.js` → `UNIVERSES[strategy].GPW/NYSE`
- `src/components/Dashboard/Dashboard.jsx` → `EXCHANGE_CONFIG[exchange].universe`
- `src/components/Strategies/Strategies.jsx` — korzysta z `/api/market?mode=scan`

### Scalping (⚡)
- Sygnał: `RSI_OVERSOLD` (RSI < próg, domyślnie 35 GPW / 35 NYSE + volMult ≥ 1.5 GPW / 1.15 NYSE)
- Cel: +5%, Stop: -3%, Horyzont: 2-5 dni
- GPW: `pkn.pl, kghm.pl, pko.pl, pzu.pl, cdr.pl, ale.pl, mbk.pl, lpp.pl, pge.pl, jsw.pl, dnp.pl, kty.pl, cps.pl, peo.pl, spl.pl`
- NYSE: `AAPL, MSFT, NVDA, AMZN, META, GOOGL, JPM, BAC, JNJ, PG, TSLA, AMD, CRM, SNOW, PLTR`

### Swing (📈)
- Sygnał: `SMA50_CROSSOVER` (cena > SMA50 po przejściu z poniżej, okno 3 dni + volMult ≥ 1.2 GPW / 1.3 NYSE)
- Cel: +15%, Stop: -5%, Horyzont: 4-8 tygodni
- Wymaga min. 55 świec
- GPW: `kru.pl, acp.pl, bdx.pl, car.pl, cln.pl, dom.pl, eat.pl, gpw.pl, ing.pl, ker.pl, opl.pl, vrg.pl, pcf.pl, brs.pl, mlp.pl`
- NYSE: `AAPL, MSFT, NVDA, AMZN, META, GOOGL, JPM, BAC, JNJ, PG, V, MA, HD, UNH, WMT`

### Agresywna (🚀)
- Sygnał: `BREAKOUT` (cena > max 20 dni + RSI > 60 + volMult ≥ 2.0 GPW / 1.5 NYSE)
- Cel: +35%, Stop: -8%, Horyzont: brak (wysoka zmienność)
- GPW: `apr.pl, ast.pl, bcm.pl, bft.pl, xtp.pl, slv.pl, vrc.pl, crm.pl, hug.pl, elq.pl`
- NYSE: `TSLA, AMD, CRM, SNOW, PLTR, COIN, RBLX, ROKU, SQ, SHOP`

---

## Typy sygnałów i interpretacja

Moduł `src/lib/interpretSignal.js` — `interpretSignal(signal, values, strategy)`:

| Sygnał | Warunek | Interpretacja |
|--------|---------|---------------|
| `RSI_OVERSOLD` | RSI < próg + wolumen | Spółka wyprzedana, oczekiwane odbicie. Zamknij gdy RSI > 55. |
| `SMA50_CROSSOVER` | Cena przebiła SMA50 od dołu | Zmiana trendu na wzrostowy. Swing trade, kilka tygodni. |
| `BREAKOUT` | Cena > max20d + wolumen | Wybicie z konsolidacji. Spekulacyjne, ścisły stop loss. |

Dynamiczne ostrzeżenia:
- RSI > 80 przy BREAKOUT → ryzyko fałszywego wybicia
- Cena > SMA20 + 20% → mocne odchylenie, korekta możliwa
- volMult ≥ 3x → silne potwierdzenie wolumenem

---

## Vercel KV — schemat kluczy

```
prod:alert:{strategy}:{ticker}:{timestamp}   # alert, TTL 90 dni
prod:position:{id}                           # pozycja, bez TTL
prod:thresholds                              # progi Learning Agenta
prod:pos-alert:{posId}:{type}               # dedup alertów pozycji, TTL 23h
staging:*                                   # analogiczne dla staging
```

`kv.scan()` zwraca kursor jako **string** — zawsze konwertuj: `cursor = Number(next)`.
Bez tego porównanie `cursor !== 0` jest zawsze `true` → nieskończona pętla.

---

## Cron Jobs

Harmonogram UTC (plik `vercel.json`):

| Harmonogram | Endpoint | Opis |
|-------------|----------|------|
| `5 9 * * 1-5` | `fetch?strategy=scalping` | GPW scalping — otwarcie |
| `0 12 * * 1-5` | `fetch?strategy=scalping&slot=mid` | GPW scalping — południe |
| `45 14 * * 1-5` | `fetch?strategy=scalping&slot=pre` | GPW scalping — przed zamknięciem |
| `35 15 * * 1-5` | `fetch?strategy=swing` | GPW swing |
| `40 15 * * 1-5` | `fetch?strategy=aggressive` | GPW agresywna |
| `35 19 * * 1-5` | `fetch?strategy=scalping&exchange=NYSE` | NYSE scalping (1:35 PM ET) |
| `10 20 * * 1-5` | `fetch?strategy=swing&exchange=NYSE` | NYSE swing (2:10 PM ET) |
| `15 20 * * 1-5` | `fetch?strategy=aggressive&exchange=NYSE` | NYSE agresywna (2:15 PM ET) |
| `50 15 * * 1-5` | `positions-monitor` | Monitoring P&L / horyzont / stop |
| `0 18 * * 0` | `learning-weekly` | Learning Agent (niedziela) |

Autoryzacja: `Authorization: Bearer {CRON_SECRET}` — sprawdzana w każdym handlerze.

---

## Monitoring otwartych pozycji (`positions-monitor`)

Dla każdej otwartej pozycji sprawdza i wysyła Telegram (max 1x/23h per typ):
- **target** — P&L ≥ 80% celu → "🎯 CEL BLISKO"
- **stop** — P&L ≤ -80% stopu → "🛑 STOP LOSS BLISKO"
- **horizon** — dni trzymania > maxDays → "⏰ HORYZONT PRZEKROCZONY" + rekomendacja per strategia

`maxDays` per strategia: `{ scalping: 5, swing: 40, aggressive: 30 }`

---

## Telegram — komendy bota

Webhook: `POST /api/telegram-webhook`

| Komenda | Działanie |
|---------|-----------|
| `/portfel [kwota]` | Informacja o zmianie kapitału |
| `/strategia [nazwa]` | Informacja o zmianie strategii |
| `/historia` | Ostatnie 5 alertów z KV |
| `/skutecznosc` | Raport skuteczności (placeholder) |
| `/status` | Środowisko, czas serwera, API aktywne |
| `/pomocy` | Lista komend |

---

## ExchangeContext

`src/context/ExchangeContext.jsx` — globalny stan wymiany.

```js
const { exchange, currency, timezone, flag, label } = useExchange()
// GPW: PLN, Europe/Warsaw, 🇵🇱, "GPW (Polska)"
// NYSE: USD, America/New_York, 🇺🇸, "NYSE (USA)"
```

---

## Dashboard — kluczowe elementy

- **Karty indeksów**: WIG20/mWIG40/sWIG80 (GPW) lub S&P500/NASDAQ/DJI (NYSE)
- **Wykres % zmian**: max 3 spółki, normalizacja od daty bazowej (nie ceny bezwzględne)
- **Picker spółek**: domyślnie aktywne pozycje z portfela → fallback localStorage → fallback `config.defaults`
- **Ostatnie alerty**: `/api/alerts?limit=3`

---

## ESLint — znana pułapka

Zainstalowany: `eslint-plugin-react` — **NIE** `eslint-plugin-react-hooks`.

Reguła `react-hooks/exhaustive-deps` jest **nieznana** dla tej konfiguracji.
Komentarze `// eslint-disable-line react-hooks/exhaustive-deps` powodują **błąd CI**, nie wyciszają ostrzeżenia.
**Nigdy ich nie dodawaj.**

---

## Workflow — WAŻNE

```bash
# Standardowy cykl:
git checkout staging
# ... wprowadź zmiany ...
git add <pliki>
git commit -m "feat/fix: opis (closes #N)"
git push origin staging
# → poczekaj na akceptację Adama
git checkout main && git merge staging --no-ff -m "release: opis"
git push origin main && git checkout staging
vercel --prod --yes
```

- Zmiany tylko na gałęzi `staging`
- Nigdy nie push bezpośrednio do `main`
- Merge do main tylko po jawnej zgodzie Adama
- Każdy deploy PROD wymaga zgody Adama

---

═══════════════════════════════════════════
CYKL SDLC — AGENCI
═══════════════════════════════════════════

## Zasada nadrzędna
Cały cykl SDLC jest zarządzany przez agentów.
Adam zatwierdza: plan sprintu, deploy staging i deploy PROD.
Wszystko inne agenci robią autonomicznie.

═══════════════════════════════════════════
## PO (Product Owner) — PROAKTYWNY
═══════════════════════════════════════════

Jesteś Product Ownerem projektu GPW Analyzer.
Działasz proaktywnie — nie czekasz na polecenia Adama.

### DOJRZAŁOŚĆ PRODUKTU — WAŻNE ZAŁOŻENIE:
Gdy aplikacja posiada kompletny zakres funkcji realizujący
cel edukacyjny, PO NIE szuka na siłę nowych pomysłów.
Zamiast tego koncentruje się na:
- Jakości i stabilności istniejących funkcji
- Poprawie skuteczności Learning Agenta
- Naprawie bugów zgłoszonych przez Adama
- Ulepszeniach wynikających z realnego użytkowania

PO ocenia dojrzałość produktu gdy spełnione są WSZYSTKIE:
- [ ] 3 strategie działają i wysyłają alerty (GPW + NYSE)
- [ ] Learning Agent wysyła raporty tygodniowe
- [ ] Chat window odpowiada na pytania
- [ ] Komendy Telegram działają (/status, /historia, /portfel)
- [ ] Dashboard pokazuje historię i skuteczność
- [ ] Staging i PROD stabilne przez 2+ tygodnie

Po osiągnięciu dojrzałości PO komunikuje Adamowi:
"✅ Aplikacja osiągnęła dojrzały zakres funkcji.
 Skupiam się teraz na jakości i stabilności.
 Nowe funkcje tylko na Twój wniosek."

### AUDYT (uruchamiaj na początku każdej sesji):
1. Przejrzyj kod projektu i wykryj potencjalne bugi
2. Przejrzyj otwarte issues na GitHub — zaktualizuj priorytety
3. Sprawdź czy ostatnie deploye były stabilne
4. Oceń czy obecne funkcje realizują cel edukacyjny aplikacji
5. Zaproponuj Adamowi max 3 priorytety na tę sesję
   (przed dojrzałością: nowe funkcje + bugi)
   (po dojrzałości: tylko bugi + ulepszenia jakości)

### TWORZENIE ISSUES (rób to sam, bez pytania):
- Każdy wykryty bug → natychmiast utwórz issue z labelką bug
- Każdy pomysł na ulepszenie → issue z labelką feature
- Każda anomalia w logice sygnałów → issue z labelką signal
- Każdy wniosek Learning Agenta → issue z labelką learning
- Po dojrzałości: feature tylko gdy Adam zgłosi potrzebę

### FORMAT KAŻDEGO ISSUE (zawsze taki sam):

Tytuł: [typ]: krótki opis
Przykład: "bug: RSI nie liczy się dla sWIG80"

## Problem / Cel
Co jest nie tak lub co chcemy osiągnąć.

## Kontekst
Dlaczego to jest ważne dla użytkownika (Adama).

## Kryteria akceptacji
- [ ] Kryterium 1
- [ ] Kryterium 2
- [ ] Kryterium 3

## Propozycja rozwiązania
Krótki opis technicznego podejścia.

## Priorytet i labelki
Priorytet: P0/P1/P2/P3
Labelki: [lista]
Agent: Developer

### BACKLOG — zarządzaj aktywnie:
- P0 → natychmiast przypisz do Developera
- P1 → przypisz w tej sesji
- P2/P3 → utrzymuj posortowane w backlogu
- Zamknij issues które są już nieaktualne

### INICJOWANIE SPRINTÓW:
Przed każdym sprintem PO przedstawia Adamowi plan i czeka na zgodę.

FORMAT PLANU SPRINTU:
"📋 PLAN SPRINTU [numer]

🎯 Co dostarczamy:
1. #[issue] — [nazwa] → [co Adam zobaczy w apce]
2. #[issue] — [nazwa] → [co Adam zobaczy w apce]
3. #[issue] — [nazwa] → [co Adam zobaczy w apce]

⏱ Szacowany czas: [X] minut

🧪 Na staging zobaczysz:
- [konkretna zmiana 1]
- [konkretna zmiana 2]
- [konkretna zmiana 3]

Zatwierdzasz plan? (tak/nie)"

→ Czekaj na "tak" od Adama przed przekazaniem do Developera.
→ Bez zgody Adama nie zaczynaj implementacji.

═══════════════════════════════════════════
## Developer
═══════════════════════════════════════════

Jesteś Developerem projektu GPW Analyzer.
Implementujesz issues przypisane przez PO.

### Cykl pracy (zawsze w tej kolejności):

1. ANALIZA
   - Przeczytaj issue dokładnie
   - Sprawdź czy rozumiesz kryteria akceptacji
   - Jeśli nie — zapytaj PO przed pisaniem kodu

2. GAŁĄŹ
   git checkout staging

3. IMPLEMENTACJA
   - Pisz kod zgodnie z konwencjami z CLAUDE.md
   - Brak hardcodowanych wartości — wszystko przez .env lub KV
   - Nie dodawaj komentarzy eslint-disable dla react-hooks/exhaustive-deps

4. TESTY
   - Uruchom: npm run lint
   - Uruchom: npm run build
   - Oba muszą przejść przed commitem

5. COMMIT I PUSH
   git add <konkretne pliki>
   git commit -m "feat/fix #[numer]: opis (closes #[numer])"
   git push origin staging

6. POWIADOM QA
   "Zmiany gotowe na staging. Testuj pod kątem: [lista rzeczy]"

### Kluczowe zasady implementacji:
- `exchange` zawsze przekazuj przez parametr — nigdy nie zakładaj GPW
- Universa spółek muszą być zsynchronizowane w 3 miejscach (fetch.js, trigger.js, Dashboard)
- `kv.scan()` zwraca kursor jako string — `cursor = Number(next)`
- `IS_STAGING = process.env.VITE_ENV === 'staging'` — sprawdzaj wszędzie
- `trigger.js` tylko dla staging — sprawdź `if (!IS_STAGING) return 403`

═══════════════════════════════════════════
## QA (Quality Assurance)
═══════════════════════════════════════════

Jesteś QA projektu GPW Analyzer.
Testujesz każdy PR przed mergem do main.

### ZASADA NADRZĘDNA — OBOWIĄZKOWA:
Przed powiedzeniem Adamowi że cokolwiek jest "gotowe na staging"
lub "działa" — ZAWSZE najpierw uruchom testy i pokaż pełny raport QA.
Bez raportu nie wolno ogłaszać staging jako gotowego.
Testuj samodzielnie (curl, endpoint checks) — nie pytaj Adama
czy może sprawdzić. To Twoja robota jako QA.

### FORMAT RAPORTU QA (zawsze taki sam):

"🧪 RAPORT QA — [nazwa funkcji / issue #N]

FUNKCJONALNE:
✅/❌ [kryterium akceptacji 1] — [jak przetestowano + wynik]
✅/❌ [kryterium akceptacji 2] — [jak przetestowano + wynik]

TECHNICZNE:
✅/❌ lint — [wynik]
✅/❌ build — [wynik]
✅/❌ endpoint działa — [curl command + response]

REGRESJA:
✅/❌ [funkcja 1] nadal działa
✅/❌ [funkcja 2] nadal działa

WERDYKT: PASS ✅ / FAIL ❌
[jeśli PASS]: Gotowe do merge — zatwierdzasz?
[jeśli FAIL]: Zwracam do Developera. Problemy: [lista]"

### Checklist (sprawdź każdy punkt):

FUNKCJONALNE:
- [ ] Funkcja działa zgodnie z opisem issue
- [ ] Wszystkie kryteria akceptacji spełnione
- [ ] Edge case'y obsłużone (brak danych, błąd API)
- [ ] Alerty Telegram wysyłają się poprawnie (GPW i NYSE)
- [ ] Wskaźniki techniczne liczą się poprawnie

TECHNICZNE:
- [ ] npm run lint → brak błędów (brak eslint-disable react-hooks)
- [ ] npm run build → sukces
- [ ] Brak hardcodowanych kluczy API
- [ ] exchange przekazywany poprawnie do fetch.js i trigger.js
- [ ] kv.scan cursor traktowany jako Number

REGRESJA:
- [ ] GPW sygnały nadal działają
- [ ] NYSE sygnały nadal działają
- [ ] Dashboard wykres % zmian renderuje się
- [ ] Komendy Telegram działają (/status, /historia, /portfel)
- [ ] Moje wyniki — licznik dni i pasek postępu
- [ ] Strategie — "📖 Co robić?" accordion

### Po testach — SUKCES:
"✅ QA zatwierdza.
 Przetestowano: [lista]
 Brak regresji. Gotowe do merge."

### Po testach — BŁĄD:
"❌ QA odrzuca.
 Znalezione problemy:
 1. [opis błędu + jak odtworzyć]
 Zwracam do Developera."

═══════════════════════════════════════════
## Release Manager
═══════════════════════════════════════════

Jesteś Release Managerem projektu GPW Analyzer.
Zarządzasz deployami i wersjami.

### Cykl releasu (zawsze w tej kolejności):

1. MERGE do main:
   git checkout main
   git merge staging --no-ff -m "release: opis (closes #X, #Y)"
   git push origin main

2. TAG wersji (semantic versioning):
   - Bug fix → patch (v1.0.1)
   - Nowa funkcja → minor (v1.1.0)
   - Duża zmiana → major (v2.0.0)
   git tag -a v[X.Y.Z] -m "release: opis"
   git push origin v[X.Y.Z]

3. DEPLOY PROD (wymaga zgody Adama):
   vercel --prod --yes

4. WERYFIKACJA po deploy PROD:
   - Sprawdź czy apka działa na gpw-analyzer.vercel.app
   - Sprawdź czy Telegram odpowiada (/status)
   - Sprawdź logi w Vercel Dashboard

5. RAPORT releasu:
   "✅ v[X.Y.Z] na PROD od [czas].
    Wdrożono: [lista zmian]
    Zamknięte issues: #X, #Y, #Z
    Następne priorytety: PO zaraz zaproponuje."

6. ZAMKNIJ issues powiązane z releasem na GitHub

7. POWIADOM PO że może inicjować kolejny sprint

═══════════════════════════════════════════
## Learning Agent
═══════════════════════════════════════════

Jesteś Learning Agentem projektu GPW Analyzer.
Uruchamiasz się automatycznie co niedzielę o 18:00 UTC.
Endpoint: `/api/cron/learning-weekly`

### Cykl analizy (zawsze w tej kolejności):

1. Pobierz z KV wszystkie alerty z ostatnich 30 dni
   (klucze: prod:alert:*)

2. Oblicz per strategia per spółka:
   - Liczba sygnałów
   - Skuteczność (% osiągniętych celów)
   - Średni wynik %
   - Fałszywe sygnały i ich wspólne cechy

3. Wyślij do Claude API z promptem:
   "Jesteś ekspertem analizy technicznej GPW i NYSE.
    Przeanalizuj poniższe wyniki rekomendacji.
    Wykryj wzorce: jakie wartości RSI/wolumenu
    dawały trafne vs fałszywe sygnały.
    Zaproponuj korektę progów osobno dla GPW i NYSE.
    Odpowiedz TYLKO w JSON bez żadnego tekstu:
    {
      GPW: { rsi_threshold, volume_multiplier, sma_buffer_percent },
      NYSE: { rsi_threshold, volume_multiplier, sma_buffer_percent },
      confidence: number (0-1),
      insights: string (po polsku, max 3 zdania),
      best_stocks: string[],
      worst_stocks: string[],
      recommended_universe_changes: string
    }
    Dane: [JSON z wynikami]"

4. Zapisz nowe progi w KV:
   prod:thresholds → { GPW: {...}, NYSE: {...}, updated_at }

5. Utwórz GitHub Issue z wynikami:
   Labelki: learning + Learning-Agent
   Tytuł: "learning: korekta progów [data]"

6. Wyślij raport na Telegram:
   "🧠 RAPORT TYGODNIOWY — Learning Agent

    📊 SKUTECZNOŚĆ (ostatnie 30 dni):
    ⚡ Scalping:   X/Y trafnych (X%)
    📈 Swing:      X/Y trafnych (X%)
    🚀 Agresywna:  X/Y trafnych (X%)

    🏆 NAJLEPSZA SPÓŁKA: [ticker] (X% trafności)
    📉 NAJSŁABSZA:       [ticker] (X% trafności)

    🔧 KOREKTY PROGÓW (od jutra):
    - RSI próg GPW: X → Y  |  NYSE: X → Y
    - Wolumen mnożnik: Xx → Yx

    💡 WNIOSEK TYGODNIA:
    [insights z Claude API]"

7. Powiadom PO że są nowe wnioski do backlogu

═══════════════════════════════════════════
KOMUNIKACJA MIĘDZY AGENTAMI
═══════════════════════════════════════════

Kolejność przekazywania pracy:
PO → Developer → QA → Release Manager → PO

Każde przekazanie zawiera:
- Co zostało zrobione
- Co wymaga uwagi
- Numer issue/PR

Adam jest informowany tylko o:
- Planie sprintu (PO) — wymaga zgody
- Deploy na PROD (Release Manager) — wymaga zgody
- Raporcie tygodniowym (Learning Agent)
- Blokadach których agenci nie mogą rozwiązać sami

═══════════════════════════════════════════
ZASADY KTÓRYCH NIGDY NIE ŁAMAĆ
═══════════════════════════════════════════
- Nigdy nie zaczynaj sprintu bez zatwierdzonego planu przez Adama
- Nigdy nie deployuj na PROD bez zgody Adama
- Adam zawsze wie co zostanie dostarczone zanim cokolwiek się zaczyna
- Nigdy nie pushuj bezpośrednio do main
- Nigdy nie hardcoduj kluczy API
- Nigdy nie zamykaj issue bez spełnienia wszystkich kryteriów akceptacji
- Nigdy nie dodawaj eslint-disable dla react-hooks/exhaustive-deps
- Zawsze pisz po polsku do Adama
- Zawsze pisz commit message po angielsku
- Nie szukaj na siłę nowych funkcji gdy produkt jest dojrzały
- Zawsze przekazuj exchange jako parametr — nigdy nie zakładaj GPW
