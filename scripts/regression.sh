#!/bin/bash
# Regresja GPW Analyzer — uruchom po każdym buildzie
# Użycie: ./scripts/regression.sh [url]
# Przykład: ./scripts/regression.sh https://gpw-analyzer-staging.vercel.app

BASE=${1:-"https://gpw-analyzer-staging.vercel.app"}
PASS=0; FAIL=0; WARN=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN+1)); }

j() { curl -sf --max-time 15 "$BASE$1" 2>/dev/null; }

py() { python3 -c "$1" 2>/dev/null; }

has_field() {
  py "import json,sys; d=json.loads('''$1'''); print('yes' if d.get('$2') is not None else 'no')"
}

echo ""
echo "🧪 REGRESJA GPW Analyzer — $BASE"
echo "══════════════════════════════════════════"

# ─── DASHBOARD ─────────────────────────────────
echo ""
echo "📊 DASHBOARD"

R=$(j "/api/market?mode=index&ticker=wig20.pl&exchange=GPW")
V=$(py "import json,sys; d=json.loads('$R'); print(d.get('close','None'))" 2>/dev/null)
[ "$V" != "None" ] && ok "WIG20 index: $V PLN" || fail "WIG20 index — brak danych"

R=$(j "/api/market?mode=index&ticker=%5Egspc&exchange=NYSE")
V=$(py "import json,sys; d=json.loads('''${R}'''); print(d.get('close','None'))")
[ "$V" != "None" ] && ok "S&P500 index: $V USD" || fail "S&P500 index — brak danych"

R=$(j "/api/market?mode=daily&ticker=pkn.pl&exchange=GPW")
C=$(py "import json,sys; d=json.loads('''${R}'''); print(len(d) if isinstance(d,list) else 0)")
[ "${C:-0}" -ge 60 ] 2>/dev/null && ok "GPW świece PKN: ${C} dni" || fail "GPW świece PKN — ${C:-0} (oczekiwane ≥60)"

R=$(j "/api/market?mode=daily&ticker=AAPL&exchange=NYSE")
C=$(py "import json,sys; d=json.loads('''${R}'''); print(len(d) if isinstance(d,list) else 0)")
[ "${C:-0}" -ge 60 ] 2>/dev/null && ok "NYSE świece AAPL: ${C} dni" || fail "NYSE świece AAPL — ${C:-0} (oczekiwane ≥60)"

R=$(j "/api/alerts?limit=3")
[ $? -eq 0 ] && ok "/api/alerts endpoint odpowiada" || fail "/api/alerts endpoint BRAKUJE — issue #26"

# ─── STRATEGIE ─────────────────────────────────
echo ""
echo "⚡ STRATEGIE (scan — wszystkie spółki)"

for STRAT in scalping swing aggressive; do
  R=$(j "/api/market?mode=scan&strategy=${STRAT}&exchange=GPW")
  C=$(py "import json,sys; d=json.loads('''${R}'''); print(len(d) if isinstance(d,list) else 0)")
  RSI_OK=$(py "
import json,sys
d=json.loads('''${R}''')
if not isinstance(d,list) or not d: print('skip')
else: print('ok' if all(r.get('rsi') is not None for r in d) else 'fail')
")
  if [ "${C:-0}" -gt 0 ] 2>/dev/null; then
    ok "GPW ${STRAT} scan: ${C} spółek"
    if [ "$RSI_OK" = "ok" ]; then
      ok "GPW ${STRAT} scan — RSI obecne dla wszystkich"
    elif [ "$RSI_OK" = "skip" ]; then
      warn "GPW ${STRAT} scan — brak spółek do sprawdzenia RSI"
    else
      fail "GPW ${STRAT} scan — RSI brakuje dla niektórych spółek (issue #25)"
    fi
  else
    fail "GPW ${STRAT} scan — brak danych"
  fi
done

R=$(j "/api/market?mode=scan&strategy=swing&exchange=NYSE")
C=$(py "import json,sys; d=json.loads('''${R}'''); print(len(d) if isinstance(d,list) else 0)")
[ "${C:-0}" -gt 0 ] 2>/dev/null && ok "NYSE swing scan: ${C} spółek" || fail "NYSE swing scan — brak danych"

echo ""
echo "⚡ STRATEGIE (signals — tylko sygnały)"

for STRAT in scalping swing aggressive; do
  R=$(j "/api/market?mode=signals&strategy=${STRAT}&exchange=GPW")
  C=$(py "import json,sys; d=json.loads('''${R}'''); print(len(d) if isinstance(d,list) else 0)")
  if [ "${C:-0}" -gt 0 ] 2>/dev/null; then
    RSI_SIG=$(py "
import json,sys
d=json.loads('''${R}''')
if not isinstance(d,list) or not d: print('skip')
else: print('ok' if all(r.get('rsi') is not None for r in d) else 'fail')
")
    [ "$RSI_SIG" = "ok" ] && ok "GPW ${STRAT} sygnały — RSI w payload" || \
      fail "GPW ${STRAT} sygnały — RSI brakuje (issue #25)"
  else
    warn "GPW ${STRAT} — brak aktywnych sygnałów (RSI w sygnale niemożliwe do weryfikacji)"
  fi
done

# ─── HISTORIA ALERTÓW ─────────────────────────
echo ""
echo "📋 HISTORIA ALERTÓW"

R=$(j "/api/alerts")
[ $? -eq 0 ] && {
  C=$(py "import json,sys; d=json.loads('''${R}'''); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null)
  ok "/api/alerts zwraca dane: ${C:-0} alertów"
} || fail "/api/alerts endpoint BRAKUJE — issue #26"

# ─── MOJE WYNIKI ──────────────────────────────
echo ""
echo "📈 MOJE WYNIKI"

R=$(j "/api/positions?status=open")
[ $? -eq 0 ] && ok "/api/positions?status=open odpowiada" || fail "/api/positions open — błąd"

R=$(j "/api/positions?status=closed")
[ $? -eq 0 ] && ok "/api/positions?status=closed odpowiada" || fail "/api/positions closed — błąd"

OPEN=$(j "/api/positions?status=open")
OPEN_C=$(py "import json,sys; d=json.loads('''${OPEN}'''); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null)
if [ "${OPEN_C:-0}" -gt 0 ] 2>/dev/null; then
  RSI_STORED=$(py "
import json,sys
d=json.loads('''${OPEN}''')
positions = d if isinstance(d,list) else []
missing = [p.get('ticker','?') for p in positions if p.get('entryRsi') is None]
print('ok' if not missing else 'missing: ' + ','.join(missing))
" 2>/dev/null)
  [ "$RSI_STORED" = "ok" ] && ok "Pozycje — entryRsi zapisane" || \
    warn "Pozycje — entryRsi brakuje (issue #28): $RSI_STORED"
else
  warn "Brak otwartych pozycji — entryRsi niemożliwe do weryfikacji"
fi

# ─── EODHD / DYWIDENDA ────────────────────────
echo ""
echo "💰 EODHD (dywidenda)"

R=$(j "/api/eodhd?ticker=peo.pl")
DIV=$(py "import json,sys; d=json.loads('''${R}'''); print(d.get('dividendYield','None'))" 2>/dev/null)
[ "$DIV" != "None" ] && ok "Dywidenda PEO: ${DIV}%" || fail "Dywidenda PEO — null (sprawdź EODHD_API_KEY)"

R=$(j "/api/eodhd?ticker=pkn.pl")
DIV=$(py "import json,sys; d=json.loads('''${R}'''); print(d.get('dividendYield','None'))" 2>/dev/null)
[ "$DIV" != "None" ] && ok "Dywidenda PKN: ${DIV}%" || warn "Dywidenda PKN — null (KGHM może być poprawnie null)"

# ─── PODSUMOWANIE ─────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  ✅ PASS: $PASS   ❌ FAIL: $FAIL   ⚠️  WARN: $WARN"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "  🟢 REGRESJA: PASS — $BASE gotowy"
  exit 0
else
  echo "  🔴 REGRESJA: FAIL — $FAIL krytycznych błędów"
  exit 1
fi
