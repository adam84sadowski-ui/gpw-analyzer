export const HORIZON = {
  scalping:   { label: '2-5 dni',              maxDays: 5  },
  swing:      { label: '4-8 tygodni',          maxDays: 40 },
  aggressive: { label: 'brak (wysoka zmienność)', maxDays: 30 },
}

const BASE_TEXT = {
  RSI_OVERSOLD:       'Spółka w trendzie wzrostowym wchodzi w korektę — RSI cofnął się do strefy pullbacku (34-50). Cena pozostaje powyżej SMA50 i blisko SMA20. Otwórz małą pozycję przy pierwszych oznakach odbicia, zamknij gdy RSI przekroczy 55 lub cel zostanie osiągnięty.',
  PULLBACK_TO_SMA50:  'Cena w trendzie wzrostowym cofnęła się do okolic 50-dniowej średniej (±3-5%). RSI zresetował się do strefy równowagi — klasyczny sygnał swing-trade "kup pullback". Trzymaj pozycję przez kilka tygodni, zamknij gdy trend osłabnie lub spółka osiągnie cel.',
  SMA50_CROSSOVER:    'Cena przebiła 50-dniową średnią ruchomą od dołu — zmiana trendu na wzrostowy. Sygnał swing-trade. Trzymaj pozycję przez kilka tygodni, zamknij gdy trend osłabnie lub spółka osiągnie cel.',
  BREAKOUT:           'Cena wybiła powyżej lokalnego maksimum z ostatnich 20 dni przy zwiększonym wolumenie. Spekulacyjny sygnał — może generować duże zyski lub szybko się odwrócić. Stosuj ścisły stop loss.',
  VOL_SURGE:          'Wyjątkowo wysoki wolumen z silnym zamknięciem przy szczycie dnia — sygnał instytucjonalnego katalizatora (earnings beat, FDA, makro). Momentum potwierdzone przez MACD i trend SMA150. Horyzont 1-2 dni, cel +3%, stop -2%. Wejdź rano następnego dnia przy utrzymaniu impulsu.',
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

  if (signal === 'VOL_SURGE') {
    if (values.volMult >= 4)       positives.push('✅ Ekstremalny wolumen (' + values.volMult + 'x) — silny instytucjonalny katalizator')
    else if (values.volMult >= 3)  positives.push('✅ Bardzo wysoki wolumen (' + values.volMult + 'x) — potwierdzony interes kupujących')
    else                           positives.push('✅ Wysoki wolumen (' + values.volMult + 'x) — powyżej progu katalizatora')
    if (values.priceChange != null) positives.push('✅ Ruch ' + (values.priceChange > 0 ? '+' : '') + values.priceChange + '% przy silnym zamknięciu — kupujący trzymali przez cały dzień')
    if (values.closeVsHigh != null && values.closeVsHigh >= 0.97) positives.push('✅ Zamknięcie przy szczycie dnia (' + Math.round(values.closeVsHigh * 100) + '% high) — brak odwrócenia intraday')
    warnings.push('⚠️ Momentum może wygasnąć następnego dnia — monitoruj otwarcie i wyjdź przy pierwszych oznakach słabości')
    warnings.push('⚠️ Wejdź rano tylko jeśli spółka utrzymuje wczorajszy poziom — nie goń jeśli otwiera znacznie wyżej')
  }

  if (signal === 'RSI_OVERSOLD') {
    if (values.rsi <= 38)      positives.push('✅ RSI głęboko w strefie pullbacku (' + values.rsi?.toFixed(1) + ') — silniejsze cofnięcie, lepsze warunki do odbicia')
    else if (values.rsi <= 44) positives.push('✅ RSI w strefie pullbacku (' + values.rsi?.toFixed(1) + ') — spółka koryguje w trendzie wzrostowym')
    if (values.volMult >= 1.5) positives.push('✅ Wolumen ' + values.volMult + 'x — potwierdza zainteresowanie kupujących na poziomie wsparcia')
  }

  if (signal === 'PULLBACK_TO_SMA50') {
    if (values.sma50Delta != null && Math.abs(values.sma50Delta) <= 1) positives.push('✅ Cena dokładnie przy SMA50 (delta: ' + values.sma50Delta + '%) — klasyczne wsparcie')
    else if (values.sma50Delta != null)                                positives.push('✅ Cena blisko SMA50 (delta: ' + values.sma50Delta + '%) — strefa pullbacku')
    if (values.volMult >= 1.3) positives.push('✅ Wolumen ' + values.volMult + 'x — potwierdza zainteresowanie przy wsparciu')
    if (values.rsi != null && values.rsi <= 45) positives.push('✅ RSI zresetowany do ' + values.rsi?.toFixed(1) + ' — spółka "oddycha" po wzrostach')
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

  if (signal === 'PULLBACK_TO_SMA50') {
    if (sma50Delta < -5) return '⚠️ Cena spadła poniżej SMA50 — pullback przeszedł w korektę. Rozważ stop loss.'
    if (sma50Delta > 20) return `⚠️ Cena odleciała od SMA50 (+${sma50Delta}%) — zrealizuj część zysku lub zaciągnij trailing stop.`
    if (sma50Delta > 0)  return `✅ Cena odbija od SMA50 (+${sma50Delta}%) — sygnał pullbacku aktywny. RSI: ${rsi?.toFixed(1)}.`
    return `📊 Cena blisko SMA50 (${sma50Delta}%). RSI: ${rsi?.toFixed(1)} — obserwuj kierunek.`
  }

  if (signal === 'SMA50_CROSSOVER') {
    if (sma50Delta < 0)  return '⚠️ Cena wróciła pod SMA50 — sygnał osłabiony. Rozważ stop loss.'
    if (sma50Delta > 25) return `⚠️ Duże oddalenie od SMA50 (+${sma50Delta}%) — korekta możliwa.`
    if (sma50Delta > 0)  return '✅ Cena powyżej SMA50 — trend wzrostowy utrzymany.'
    return '📊 SMA50: neutralnie.'
  }

  if (signal === 'VOL_SURGE') {
    if (rsi > 72)       return '⚠️ RSI wykupiony (>72) — momentum słabnie. Rozważ realizację zysku.'
    if (volMult < 1.5)  return '⚠️ Wolumen opada — katalizator wygasa. Monitoruj uważnie.'
    if (isPriceDown)    return '⚠️ Cena poniżej ceny wejścia — momentum nie podtrzymane. Rozważ zamknięcie.'
    if (volMult >= 2)   return `✅ Wolumen nadal podwyższony (${volMult}x) — katalizator aktywny. RSI ${rsi?.toFixed(1)}.`
    return `📊 VOL_SURGE aktywny. RSI: ${rsi?.toFixed(1)}, wolumen: ${volMult}x.`
  }

  return null
}
