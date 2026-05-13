export const HORIZON = {
  scalping:   { label: '2-5 dni',              maxDays: 5  },
  swing:      { label: '4-8 tygodni',          maxDays: 40 },
  aggressive: { label: 'brak (wysoka zmienność)', maxDays: 30 },
}

const BASE_TEXT = {
  RSI_OVERSOLD:    'Spółka była mocno wyprzedana (RSI poniżej progu). Oczekiwane techniczne odbicie w górę. Otwórz małą pozycję i obserwuj — zamknij gdy cel zostanie osiągnięty lub RSI przekroczy 55.',
  SMA50_CROSSOVER: 'Cena przebiła 50-dniową średnią ruchomą od dołu — zmiana trendu na wzrostowy. Sygnał swing-trade. Trzymaj pozycję przez kilka tygodni, zamknij gdy trend osłabnie lub spółka osiągnie cel.',
  BREAKOUT:        'Cena wybiła powyżej lokalnego maksimum z ostatnich 20 dni przy zwiększonym wolumenie. Spekulacyjny sygnał — może generować duże zyski lub szybko się odwrócić. Stosuj ścisły stop loss.',
}

export function interpretSignal(signal, values = {}, strategy = 'scalping') {
  const text    = BASE_TEXT[signal] ?? 'Sygnał techniczny — sprawdź wskaźniki.'
  const horizon = HORIZON[strategy] ?? HORIZON.scalping
  const warnings  = []
  const positives = []

  if (signal === 'BREAKOUT') {
    if (values.rsi > 80)      warnings.push('⚠️ RSI mocno wykupiony (' + values.rsi?.toFixed(1) + ' > 80) — ryzyko fałszywego wybicia i korekty')
    else if (values.rsi > 70) warnings.push('⚠️ RSI wykupiony (' + values.rsi?.toFixed(1) + ' > 70) — momentum silne, ale korekta możliwa')
    if (values.volMult >= 3)      positives.push('✅ Bardzo silny wolumen (' + values.volMult + 'x) — potwierdza wybicie')
    else if (values.volMult >= 2) positives.push('✅ Silny wolumen (' + values.volMult + 'x) — potwierdza sygnał')
  }

  if (signal === 'RSI_OVERSOLD') {
    if (values.rsi < 20)      positives.push('✅ RSI ekstremalnie niski (' + values.rsi?.toFixed(1) + ') — silne wyprzedanie')
    else if (values.rsi < 30) positives.push('✅ RSI mocno wyprzedany (' + values.rsi?.toFixed(1) + ') — dobre warunki do odbicia')
    if (values.volMult >= 2)  positives.push('✅ Wolumen ' + values.volMult + 'x — potwierdza zainteresowanie kupujących')
  }

  if (signal === 'SMA50_CROSSOVER') {
    if (values.volMult >= 1.5)                                     positives.push('✅ Wolumen ' + values.volMult + 'x — potwierdza zmianę trendu')
    if (values.sma20 && values.sma50 && values.sma20 > values.sma50) positives.push('✅ SMA20 powyżej SMA50 — golden cross w toku')
  }

  if (values.price && values.sma20) {
    const devPct = (values.price - values.sma20) / values.sma20 * 100
    if (devPct > 20) warnings.push('⚠️ Cena ' + devPct.toFixed(0) + '% powyżej SMA20 — mocne odchylenie, korekta możliwa')
  }

  return { text, warnings, positives, horizon }
}

// Position-aware interpretation for open positions.
// Hierarchy: stop-loss override → volume direction → premise validation.
export function interpretPositionState(pos, currentPrice, cur) {
  if (!cur || currentPrice == null) return null

  const { signal, entryPrice, stopLoss, trailingActive, trailingStopPrice } = pos
  const { rsi, volMult, sma50Delta } = cur

  // Priority 1 — stop-loss override
  if (trailingActive && trailingStopPrice != null && currentPrice <= trailingStopPrice) {
    return `⛔ Trailing stop przekroczony — cena ${currentPrice.toFixed(2)} ≤ stop ${trailingStopPrice.toFixed(2)}. Zamknij pozycję.`
  }
  const staticStop = entryPrice != null && stopLoss != null ? entryPrice * (1 - stopLoss / 100) : null
  if (staticStop != null && currentPrice <= staticStop) {
    return `⛔ Stop loss osiągnięty — cena ${currentPrice.toFixed(2)} ≤ stop ${staticStop.toFixed(2)}. Zamknij pozycję.`
  }

  // Priority 2 — volume direction: high volume on a falling price = selling pressure
  const isPriceDown = currentPrice < entryPrice
  if (isPriceDown && volMult >= 2) {
    if (signal === 'BREAKOUT') {
      return `⛔ Wybicie zanegowane — cena wróciła poniżej ceny wejścia. Wolumen ${volMult}x przy spadku = presja sprzedających. Rozważ zamknięcie.`
    }
    return `⚠️ Wysoki wolumen (${volMult}x) przy spadającej cenie — presja sprzedających. Monitoruj uważnie.`
  }

  // Priority 3 — premise validation per signal type
  if (signal === 'BREAKOUT') {
    if (isPriceDown)          return '⚠️ Wybicie zanegowane — cena wróciła poniżej ceny wejścia. Rozważ zamknięcie.'
    if (rsi > 80)             return '⚠️ RSI wykupiony (>80) — ryzyko korekty. Rozważ trailing stop.'
    if (volMult < 1.2)        return '⚠️ Wolumen opada — breakout może być fałszywy. Monitoruj uważnie.'
    if (sma50Delta > 30)      return `⚠️ Mocne oddalenie od SMA50 (+${sma50Delta}%) — korekta możliwa.`
    if (volMult >= 2)         return `✅ Wolumen potwierdza wybicie (${volMult}x). RSI ${rsi?.toFixed(1)} — trend kontynuowany.`
    return `📊 Breakout aktywny. RSI: ${rsi?.toFixed(1)}, wolumen: ${volMult}x.`
  }

  if (signal === 'RSI_OVERSOLD') {
    if (rsi > 70) return '⚠️ RSI wykupiony (>70) — rozważ realizację zysku.'
    if (rsi > 55) return '💡 RSI wyszedł ze strefy wyprzedania — rozważ realizację zysku.'
    if (rsi < 40) return '✅ RSI nadal w strefie wyprzedania — sygnał aktywny.'
    return `📊 RSI ${rsi?.toFixed(1)} — w normalnym zakresie. Trend wzrostowy.`
  }

  if (signal === 'SMA50_CROSSOVER') {
    if (sma50Delta < 0)  return '⚠️ Cena wróciła pod SMA50 — sygnał osłabiony. Rozważ stop loss.'
    if (sma50Delta > 25) return `⚠️ Duże oddalenie od SMA50 (+${sma50Delta}%) — korekta możliwa.`
    if (sma50Delta > 0)  return '✅ Cena powyżej SMA50 — trend wzrostowy utrzymany.'
    return '📊 SMA50: neutralnie.'
  }

  return null
}
