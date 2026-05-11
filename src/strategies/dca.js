export const ETF_CATALOG = [
  { ticker: 'vwce', name: 'VWCE', fullName: 'Vanguard FTSE All-World',           ter: 0.22, isin: 'IE00BK5BQT80', type: 'acc', description: 'Cały świat, 3700 spółek' },
  { ticker: 'cspx', name: 'CSPX', fullName: 'iShares Core S&P 500',              ter: 0.07, isin: 'IE00B5BMR087', type: 'acc', description: 'USA Top 500' },
  { ticker: 'eqqq', name: 'EQQQ', fullName: 'Invesco NASDAQ-100',                ter: 0.30, isin: 'IE0032077012', type: 'acc', description: '100 spółek tech' },
  { ticker: 'eunl', name: 'EUNL', fullName: 'iShares Core MSCI World',           ter: 0.20, isin: 'IE00B4L5Y983', type: 'acc', description: '1500 spółek, rynki rozwinięte' },
  { ticker: 'vhyl', name: 'VHYL', fullName: 'Vanguard FTSE All-World High Div.', ter: 0.29, isin: 'IE00B8GKDB10', type: 'dist', description: '~3.5%/rok dywidenda, kwartalnie' },
  { ticker: 'vwrl', name: 'VWRL', fullName: 'Vanguard FTSE All-World (Dist.)',   ter: 0.22, isin: 'IE00B3RBWM25', type: 'dist', description: 'Wersja dywidendowa VWCE' },
]

export function getDCAReminder(config, currentPrices) {
  if (!config?.etfs?.length || !config.monthlyPLN) return null

  return config.etfs.map(({ ticker, pct }) => {
    const etfInfo   = ETF_CATALOG.find(e => e.ticker === ticker.toLowerCase())
    const price     = currentPrices[ticker.toLowerCase()] ?? null
    const amountPLN = Math.round(config.monthlyPLN * (pct / 100))
    const units     = price != null && price > 0
      ? Math.round(amountPLN / price * 100) / 100
      : null

    return {
      ticker:      ticker.toUpperCase(),
      name:        etfInfo?.name        ?? ticker.toUpperCase(),
      fullName:    etfInfo?.fullName    ?? '',
      description: etfInfo?.description ?? '',
      amountPLN,
      price,
      units,
    }
  })
}

// Future value of regular monthly payments: FV = PMT × ((1+r)^n − 1) / r
export function calculateDCAProjection(monthlyPLN, years, annualRatePct = 8) {
  const months = years * 12
  const r = annualRatePct / 100 / 12
  if (r === 0) return monthlyPLN * months
  return Math.round(monthlyPLN * (Math.pow(1 + r, months) - 1) / r)
}
