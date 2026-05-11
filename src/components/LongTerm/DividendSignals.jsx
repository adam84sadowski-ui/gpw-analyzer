import { useState, useEffect } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { DIVIDEND_UNIVERSE, detectDividendSignal, daysToExDividend } from '../../strategies/dividend.js'

function SignalCard({ ticker, signal }) {
  const label    = ticker.replace('.pl', '').toUpperCase()
  const currency = signal.currency ?? (ticker.endsWith('.pl') ? 'PLN' : 'USD')

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-lg">{label}</span>
        <span className="text-xs bg-green-800 text-green-200 px-2 py-0.5 rounded">💰 DYWIDENDOWA</span>
      </div>
      {signal.shortName && <p className="text-xs text-gray-400">{signal.shortName}</p>}

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="bg-gpw-dark rounded p-2 text-center">
          <div className="text-green-400 font-bold">{signal.dividendYieldPct}%</div>
          <div className="text-xs text-gray-400">Yield</div>
        </div>
        <div className="bg-gpw-dark rounded p-2 text-center">
          <div className="text-yellow-400 font-bold">{signal.pe ?? '—'}</div>
          <div className="text-xs text-gray-400">P/E</div>
        </div>
        <div className="bg-gpw-dark rounded p-2 text-center">
          <div className="text-blue-400 font-bold">{signal.payoutRatioPct != null ? `${signal.payoutRatioPct}%` : '—'}</div>
          <div className="text-xs text-gray-400">Payout</div>
        </div>
      </div>

      {signal.price != null && (
        <p className="text-sm text-gray-300">Kurs: <span className="font-medium">{signal.price} {currency}</span></p>
      )}

      {signal.exDividendDate && (() => {
        const days = daysToExDividend(signal.exDividendDate)
        return (
          <p className={`text-xs ${days != null && days <= 10 ? 'text-yellow-400 font-semibold' : 'text-gray-400'}`}>
            📅 Ex-dividend: {signal.exDividendDate}
            {days != null && days >= 0 && ` (za ${days} dni)`}
            {days != null && days < 0 && ' (minęła)'}
          </p>
        )
      })()}
    </div>
  )
}

export default function DividendSignals() {
  const { exchange } = useExchange()
  const [signals,  setSignals]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const tickers = DIVIDEND_UNIVERSE[exchange] ?? []

    Promise.allSettled(
      tickers.map(ticker =>
        fetch(`/api/market?mode=fundamentals&ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`)
          .then(r => r.ok ? r.json() : null)
          .then(fund => fund ? { ticker, fund } : null)
      )
    ).then(results => {
      const detected = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(({ value: { ticker, fund } }) => {
          const sig = detectDividendSignal(ticker, fund)
          return sig ? { ticker, signal: sig } : null
        })
        .filter(Boolean)
      setSignals(detected)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [exchange])

  if (loading) return <p className="text-gray-400 text-sm">Ładowanie danych fundamentalnych…</p>
  if (error)   return <p className="text-red-400 text-sm">Błąd: {error}</p>

  if (!signals.length) return (
    <div className="text-gray-400 text-sm space-y-1">
      <p>Brak aktywnych sygnałów dywidendowych dla {exchange}.</p>
      <p className="text-xs">Kryteria: Yield &gt; 3%, Payout Ratio &lt; 70%, P/E poniżej średniej sektorowej.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">{signals.length} sygnał(y) — {exchange}</p>
      {signals.map(({ ticker, signal }) => (
        <SignalCard key={ticker} ticker={ticker} signal={signal} />
      ))}
    </div>
  )
}
