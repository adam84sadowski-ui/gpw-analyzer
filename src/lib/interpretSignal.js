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
