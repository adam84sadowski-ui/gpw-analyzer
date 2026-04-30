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
- PROD: gpw-analyzer.vercel.app (gałąź main)
- STAGING: gpw-analyzer-staging.vercel.app (gałąź staging)

## Zmienne środowiskowe
Zawsze używaj .env — nigdy nie hardcoduj kluczy.

## Workflow
- feature/* → PR do staging → QA → PR do main → PROD
- Nigdy nie push bezpośrednio do main
- Każdy deploy staging: `vercel --yes` (bez --prod)
- Każdy deploy PROD: wymaga jawnej zgody Adama

## Komendy

```bash
cd gpw-analyzer
npm run dev          # lokalny dev server (Vite HMR)
npm run build        # build produkcyjny → dist/
npm run test         # testy jednostkowe
npm run lint         # ESLint
vercel --yes         # deploy staging
vercel --prod --yes  # deploy PROD (tylko za zgodą!)
```

## Źródła danych
- Stooq.com: dane dzienne i bieżące (30 min opóźnienie), darmowe
- EODHD: P/E ratio i dywidendy, max 10 zapytań dziennie
- Tickery GPW: suffix .pl (np. pkn.pl, kghm.pl)

## Strategia cache
- Vercel KV: dane świeższe niż 25 min → nie odpytuj
- localStorage: portfel, ustawienia
- Filtr indeksowy: sprawdź indeks PRZED spółkami (1 call)

## Linki
- GitHub: https://github.com/adam84sadowski/gpw-analyzer
- PROD: https://gpw-analyzer.vercel.app
- STAGING: https://gpw-analyzer-staging.vercel.app
