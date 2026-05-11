export const DIVIDEND_UNIVERSE = {
  GPW:  [
    'pko.pl', 'pzu.pl', 'pkn.pl', 'kghm.pl',
    'peo.pl', 'bdx.pl', 'opl.pl', 'gpw.pl', 'kru.pl', 'acp.pl',
  ],
  NYSE: [
    'JNJ', 'KO', 'PG', 'XOM', 'ABBV',
    'VZ', 'PFE', 'CVX', 'IBM', 'MO',
  ],
}

export const COMPANY_NAMES = {
  'pko.pl':  'PKO Bank Polski',
  'pzu.pl':  'PZU',
  'pkn.pl':  'PKN Orlen',
  'kghm.pl': 'KGHM',
  'peo.pl':  'Bank Pekao',
  'bdx.pl':  'Budimex',
  'opl.pl':  'Orange Polska',
  'gpw.pl':  'Giełda Papierów Wartościowych',
  'kru.pl':  'Kruk',
  'acp.pl':  'Asseco Poland',
  'JNJ':     'Johnson & Johnson',
  'KO':      'Coca-Cola',
  'PG':      'Procter & Gamble',
  'XOM':     'ExxonMobil',
  'ABBV':    'AbbVie',
  'VZ':      'Verizon',
  'PFE':     'Pfizer',
  'CVX':     'Chevron',
  'IBM':     'IBM',
  'MO':      'Altria Group',
}

const SECTOR_PE = {
  'pko.pl':  12,
  'pzu.pl':  13,
  'pkn.pl':  10,
  'kghm.pl':  8,
  'peo.pl':  11,
  'bdx.pl':  18,
  'opl.pl':  12,
  'gpw.pl':  15,
  'kru.pl':  10,
  'acp.pl':  13,
  'JNJ':     18,
  'KO':      24,
  'PG':      24,
  'XOM':     14,
  'ABBV':    16,
  'VZ':      10,
  'PFE':     10,
  'CVX':     12,
  'IBM':     20,
  'MO':      10,
}

export function detectDividendSignal(ticker, fundamentals) {
  if (!fundamentals) return null
  const { dividendYield, payoutRatio, forwardPE, trailingPE } = fundamentals

  if (dividendYield == null || dividendYield < 0.03) return null
  if (payoutRatio != null && payoutRatio > 0.70) return null

  const pe = forwardPE ?? trailingPE
  const sectorPE = SECTOR_PE[ticker.toLowerCase()] ?? SECTOR_PE[ticker] ?? 20
  if (pe != null && pe > sectorPE * 1.2) return null

  return {
    signal:           'DIVIDEND_YIELD',
    dividendYieldPct: Math.round(dividendYield * 1000) / 10,
    payoutRatioPct:   payoutRatio != null ? Math.round(payoutRatio * 100) : null,
    pe:               pe != null ? Math.round(pe * 10) / 10 : null,
    exDividendDate:   fundamentals.exDividendDate,
    dividendDate:     fundamentals.dividendDate,
    price:            fundamentals.price,
    currency:         fundamentals.currency,
    shortName:        fundamentals.shortName,
  }
}

export function getDividendCalendar(tickerFundamentalsMap) {
  const now  = new Date()
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  return Object.entries(tickerFundamentalsMap)
    .filter(([, f]) => {
      if (!f?.exDividendDate) return false
      const d = new Date(f.exDividendDate)
      return d >= now && d <= in30
    })
    .map(([ticker, f]) => ({
      ticker,
      exDividendDate:   f.exDividendDate,
      dividendDate:     f.dividendDate,
      dividendYieldPct: f.dividendYield != null ? Math.round(f.dividendYield * 1000) / 10 : null,
      price:            f.price,
      currency:         f.currency,
      shortName:        f.shortName ?? COMPANY_NAMES[ticker] ?? null,
    }))
    .sort((a, b) => new Date(a.exDividendDate) - new Date(b.exDividendDate))
}

export function calculateAnnualDividendIncome(positions, tickerFundamentalsMap) {
  return positions
    .filter(p => p?.status === 'open')
    .reduce((sum, pos) => {
      const f = tickerFundamentalsMap[pos.ticker]
      if (!f?.dividendYield) return sum
      return sum + (pos.positionSize ?? 0) * f.dividendYield
    }, 0)
}

export function daysToExDividend(exDividendDate) {
  if (!exDividendDate) return null
  const today  = new Date(new Date().toISOString().slice(0, 10))
  const exDate = new Date(exDividendDate)
  return Math.round((exDate - today) / 86400000)
}
