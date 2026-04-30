# GPW Analyzer — Instrukcja dla Agentów Claude

## Cel projektu
Edukacyjny asystent giełdowy analizujący GPW.
Wysyła alerty na Telegram. Uczy się na podstawie
wyników poprzednich rekomendacji.

## Agenci i ich role

### PO (Product Owner)
- Definiuje priorytety funkcji
- Tworzy i opisuje GitHub Issues
- Akceptuje lub odrzuca PR-y
- Pilnuje że aplikacja realizuje cel edukacyjny
- Prompt: "Działasz jako PO projektu GPW Analyzer.
  Twoja rola to definiowanie wymagań, tworzenie
  issues i akceptacja zmian."

### Developer
- Implementuje funkcje zgodnie z issues
- Pisze testy jednostkowe
- Tworzy PR-y do gałęzi staging
- Dba o jakość kodu i dokumentację
- Prompt: "Działasz jako Developer projektu GPW Analyzer.
  Implementujesz funkcje, piszesz testy, tworzysz PR-y."

### QA (Quality Assurance)
- Testuje funkcje na środowisku staging
- Weryfikuje alerty Telegram
- Sprawdza poprawność wskaźników technicznych
- Raportuje błędy jako GitHub Issues
- Prompt: "Działasz jako QA projektu GPW Analyzer.
  Testujesz funkcje na staging, raportujesz błędy."

### Release Manager
- Zarządza wdrożeniami na PROD
- Merguje staging do main po akceptacji QA
- Taguje wersje (v1.0.0, v1.1.0 itd.)
- Monitoruje stabilność PROD
- Prompt: "Działasz jako Release Manager projektu
  GPW Analyzer. Zarządzasz wdrożeniami i wersjami."

### Learning Agent
- Analizuje wyniki poprzednich rekomendacji
- Wykrywa wzorce skutecznych i nieskutecznych sygnałów
- Aktualizuje progi wskaźników (RSI, wolumen, SMA)
- Generuje raport tygodniowy z wnioskami
- Prompt: "Działasz jako Learning Agent projektu
  GPW Analyzer. Analizujesz wyniki rekomendacji
  i ulepszasz logikę wskaźników na podstawie danych."

## Konwencje kodu
- Komponenty React: PascalCase
- Funkcje pomocnicze: camelCase
- Stałe: UPPER_SNAKE_CASE
- Pliki CSS: kebab-case
- Testy: *.test.jsx

## Środowiska
- PROD: https://gpw-analyzer.vercel.app (gałąź main)
- STAGING: https://gpw-analyzer-staging.vercel.app (gałąź staging)
- GitHub: https://github.com/adam84sadowski-ui/gpw-analyzer

## Zmienne środowiskowe
Zawsze używaj .env — nigdy nie hardcoduj kluczy.

```
ANTHROPIC_API_KEY=        # Claude API
EODHD_API_KEY=            # EODHD (P/E, dywidendy)
TELEGRAM_BOT_TOKEN=       # Telegram PROD
TELEGRAM_CHAT_ID=         # Telegram PROD
TELEGRAM_BOT_TOKEN_STAGING= # Telegram STAGING
TELEGRAM_CHAT_ID_STAGING=   # Telegram STAGING
VERCEL_TOKEN=             # Vercel CLI
CRON_SECRET=              # autoryzacja cron endpoints
VITE_ENV=staging          # staging | production
# KV dodawane automatycznie przez Vercel/Upstash:
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

## Workflow — WAŻNE
- Zmiany tylko na gałęzi `staging`
- Nigdy nie push bezpośrednio do `main`
- Po zakończeniu pracy: "Gotowe na staging — zatwierdzasz merge do main?"
- Merge do `main` tylko po jawnej zgodzie Adama (`tak`)
- Każdy deploy PROD: `vercel --prod --yes` (tylko po zgodzie!)

```bash
# Standardowy cykl:
git checkout staging
# ... wprowadź zmiany ...
git add <pliki>
git commit -m "feat/fix: opis"
git push origin staging
# → poczekaj na akceptację Adama
git checkout main && git merge staging --no-ff -m "release: opis"
git push origin main && git checkout staging
vercel --prod --yes
```

## Komendy

```bash
cd gpw-analyzer
npm run dev          # lokalny dev server (Vite HMR)
npm run build        # build produkcyjny → dist/
npm run test         # testy jednostkowe (vitest)
npm run lint         # ESLint
vercel --yes         # deploy staging + przestaw alias ręcznie
vercel --prod --yes  # deploy PROD (tylko za zgodą Adama!)
vercel alias set <url> gpw-analyzer-staging.vercel.app  # po deploy staging
```

## Źródła danych
- **Yahoo Finance** (`/api/stooq` proxy): dane dzienne i bieżące, darmowe, bez klucza
  - Ticker format wewnętrzny: suffix `.pl` (np. `pkn.pl`, `kghm.pl`)
  - Ticker format Yahoo: suffix `.WA` (np. `PKN.WA`, `KGH.WA`) — konwersja w `api/stooq.js`
  - NIGDY nie odpytuj Yahoo Finance bezpośrednio z przeglądarki (CORS) — zawsze przez `/api/stooq`
- **EODHD**: P/E ratio i dywidendy, max 10 zapytań dziennie, raz o 17:30
- **Claude API**: `claude-sonnet-4-20250514` — chat window + Learning Agent

## Vercel KV (Upstash Redis)
- Jedna baza dla wszystkich środowisk
- Prefiks kluczy: `prod:` dla PROD, `staging:` dla STAGING
- Przykłady: `prod:alert:swing:pkn.pl:1234567890`, `staging:thresholds`
- TTL alertów: 90 dni
- Cache danych rynkowych: 25 minut (in-memory w `api/stooq.js`)

## Cron Jobs (Vercel Hobby — 1x dziennie)
- Scalping:   `05 09 * * 1-5` — WIG20
- Swing:      `15 09 * * 1-5` — mWIG40
- Agresywna:  `30 09 * * 1-5` — sWIG80
- Learning:   `00 18 * * 0`   — niedziela
- Issue #1: przywrócenie pełnej częstotliwości wymaga Vercel Pro

## Strategia cache / filtr indeksowy
- Sprawdź indeks PRZED spółkami (1 call)
- Brak sygnału na indeksie → pomiń spółki → 0 dodatkowych calls
- Cache in-memory 25 min w `api/stooq.js`
- localStorage: portfel, ustawienia użytkownika
