import { fetchCandlesStooq } from './stooq.js'
import { fetchCandlesTwelveData } from './twelvedata.js'

const TICKER_MAP = {
  'kghm.pl':   'KGH.WA',
  'mwig40.pl': 'MWIG40.WA',
  'swig80.pl': 'SWIG80.WA',
}

const ETF_TICKER_MAP = {
  'vwce': 'VWCE.L',
  'cspx': 'CSPX.L',
  'eqqq': 'EQQQ.L',
  'eunl': 'EUNL.L',
  'vhyl': 'VHYL.L',
  'vwrl': 'VWRL.L',
}

export function toYahooSymbol(ticker, exchange = 'GPW') {
  if (exchange === 'ETF') {
    const t = ticker.toLowerCase()
    return ETF_TICKER_MAP[t] ?? ticker.toUpperCase() + '.L'
  }
  if (exchange === 'NYSE') return ticker.toUpperCase().replace(/\.pl$/i, '')
  const t = ticker.toLowerCase()
  return TICKER_MAP[t] ?? t.replace(/\.pl$/, '').toUpperCase() + '.WA'
}

async function yahooFetch(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}&includePrePost=false`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  return res.json()
}

async function fetchCandlesYahoo(ticker, exchange) {
  const symbol = toYahooSymbol(ticker, exchange)
  const json = await yahooFetch(symbol, '1y')
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const shortName = result.meta?.shortName ?? null
  const ts = result.timestamp ?? []
  const q  = result.indicators.quote[0]
  const candles = ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().slice(0, 10),
      open:   q.open[i]   ? Math.round(q.open[i]   * 100) / 100 : null,
      high:   q.high[i]   ? Math.round(q.high[i]   * 100) / 100 : null,
      low:    q.low[i]    ? Math.round(q.low[i]    * 100) / 100 : null,
      close:  q.close[i]  ? Math.round(q.close[i]  * 100) / 100 : null,
      volume: q.volume[i] ?? null,
    }))
    .filter(c => c.close !== null)
  return { candles, shortName }
}

export async function fetchCandlesExtended(ticker, exchange = 'GPW', range = '5y') {
  const symbol = toYahooSymbol(ticker, exchange)
  const json   = await yahooFetch(symbol, range)
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const shortName = result.meta?.shortName ?? null
  const ts = result.timestamp ?? []
  const q  = result.indicators.quote[0]
  const candles = ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().slice(0, 10),
      open:   q.open[i]   ? Math.round(q.open[i]   * 100) / 100 : null,
      high:   q.high[i]   ? Math.round(q.high[i]   * 100) / 100 : null,
      low:    q.low[i]    ? Math.round(q.low[i]    * 100) / 100 : null,
      close:  q.close[i]  ? Math.round(q.close[i]  * 100) / 100 : null,
      volume: q.volume[i] ?? null,
    }))
    .filter(c => c.close !== null)
  return { candles, shortName }
}

export async function fetchCandles(ticker, exchange = 'GPW') {
  if (exchange === 'GPW') {
    const data = await fetchCandlesStooq(ticker).catch(() => null)
    if (data) return data
  }
  if (exchange === 'NYSE') {
    const data = await fetchCandlesTwelveData(ticker).catch(() => null)
    if (data) return data
  }
  return fetchCandlesYahoo(ticker, exchange)
}

export async function fetchCurrent(ticker, exchange = 'GPW') {
  const symbol = toYahooSymbol(ticker, exchange)
  const json = await yahooFetch(symbol, '5d')
  const result = json?.chart?.result?.[0]
  const meta = result?.meta
  if (!meta) return null
  return {
    close:     meta.regularMarketPrice ?? null,
    open:      meta.regularMarketOpen  ?? null,
    high:      meta.regularMarketDayHigh  ?? null,
    low:       meta.regularMarketDayLow   ?? null,
    volume:    meta.regularMarketVolume   ?? null,
    date:      new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10),
    Close:     String(meta.regularMarketPrice ?? 'N/D'),
    Open:      String(meta.regularMarketOpen  ?? 'N/D'),
    shortName: result.meta?.shortName ?? null,
  }
}

export async function fetchFundamentals(ticker, exchange = 'GPW') {
  const symbol = toYahooSymbol(ticker, exchange)
  const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=summaryDetail%2CdefaultKeyStatistics%2Cprice`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const result = json?.quoteSummary?.result?.[0]
  if (!result) return null

  const sd = result.summaryDetail ?? {}
  const ks = result.defaultKeyStatistics ?? {}
  const pr = result.price ?? {}

  const tsToDate = (ts) => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null

  return {
    price:                    pr.regularMarketPrice?.raw ?? null,
    currency:                 pr.currency ?? null,
    shortName:                pr.shortName ?? null,
    dividendYield:            sd.dividendYield?.raw ?? null,
    payoutRatio:              sd.payoutRatio?.raw ?? null,
    forwardPE:                sd.forwardPE?.raw ?? ks.forwardPE?.raw ?? null,
    trailingPE:               sd.trailingPE?.raw ?? null,
    exDividendDate:           tsToDate(sd.exDividendDate?.raw),
    dividendDate:             tsToDate(sd.dividendDate?.raw),
    fiveYearAvgDividendYield: sd.fiveYearAvgDividendYield?.raw ?? null,
  }
}
