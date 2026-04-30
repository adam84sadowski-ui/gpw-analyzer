export function pln(value) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value)
}

export function pct(value, decimals = 1) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

export function round2(value) {
  return Math.round(value * 100) / 100
}

export function tickerDisplay(ticker) {
  // "pkn.pl" → "PKN"
  return ticker.replace(/\.pl$/, '').toUpperCase()
}
