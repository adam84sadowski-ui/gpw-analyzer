import { useState, useEffect } from 'react'
import { DIVIDEND_UNIVERSE, COMPANY_NAMES, getDividendCalendar, daysToExDividend } from '../../strategies/dividend.js'
import { useExchange } from '../../context/ExchangeContext.jsx'

export default function DividendCalendar() {
  const { exchange } = useExchange()
  const [calendar, setCalendar] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    const tickers = DIVIDEND_UNIVERSE[exchange] ?? []

    Promise.allSettled(
      tickers.map(ticker =>
        fetch(`/api/market?mode=fundamentals&ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`)
          .then(r => r.ok ? r.json() : null)
          .then(fund => fund ? [ticker, fund] : null)
      )
    ).then(results => {
      const fundMap = Object.fromEntries(
        results
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value)
      )
      setCalendar(getDividendCalendar(fundMap))
    }).finally(() => setLoading(false))
  }, [exchange])

  if (loading) return <p className="text-gray-400 text-sm">Ładowanie kalendarza…</p>

  if (!calendar.length) return (
    <p className="text-gray-400 text-sm">Brak dywidend w ciągu najbliższych 30 dni dla {exchange}.</p>
  )

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">Najbliższe ex-dividend dates — {exchange}</p>
      {calendar.map(({ ticker, exDividendDate, dividendDate, dividendYieldPct, price, currency, shortName }) => {
        const label = ticker.replace('.pl', '').toUpperCase()
        const days  = daysToExDividend(exDividendDate)
        const urgent = days != null && days <= 5
        return (
          <div key={ticker} className={`bg-gpw-card border rounded-lg p-3 ${urgent ? 'border-yellow-500' : 'border-gpw-border'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold">{label}</span>
                <span className="text-xs text-gray-400">
                  {shortName ?? COMPANY_NAMES[ticker.toLowerCase()] ?? COMPANY_NAMES[ticker] ?? ''}
                </span>
              </div>
              {urgent && <span className="text-xs bg-yellow-700 text-yellow-200 px-2 py-0.5 rounded">⚠️ WKRÓTCE</span>}
            </div>
            <div className="mt-1 text-sm space-y-0.5">
              <p className={urgent ? 'text-yellow-400 font-semibold' : 'text-gray-300'}>
                Ex-dividend: <b>{exDividendDate}</b>
                {days != null && ` (za ${days} dni)`}
              </p>
              {dividendDate && <p className="text-gray-400 text-xs">Wypłata: {dividendDate}</p>}
              {dividendYieldPct != null && (
                <p className="text-green-400 text-xs">Yield: {dividendYieldPct}%{price != null ? ` | Kurs: ${price} ${currency ?? ''}` : ''}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
