import { useState, useEffect } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { DIVIDEND_UNIVERSE, COMPANY_NAMES, daysToExDividend } from '../../strategies/dividend.js'

function criteriaCheck(fund) {
  if (!fund) return { yieldOk: false, payoutOk: false, peOk: false, dataOk: false }
  const SECTOR_PE = {
    'pko.pl': 12, 'pzu.pl': 13, 'pkn.pl': 10, 'kghm.pl': 8,
    JNJ: 18, KO: 24, PG: 24, XOM: 14, ABBV: 16,
  }
  const pe        = fund.forwardPE ?? fund.trailingPE
  const sectorPE  = SECTOR_PE[fund._ticker?.toLowerCase()] ?? SECTOR_PE[fund._ticker] ?? 20
  return {
    yieldOk:  fund.dividendYield != null && fund.dividendYield >= 0.03,
    payoutOk: fund.payoutRatio == null ? null : fund.payoutRatio < 0.70,
    peOk:     pe == null               ? null : pe <= sectorPE * 1.2,
    dataOk:   fund.payoutRatio != null || pe != null,
  }
}

function CriterionDot({ ok, label }) {
  if (ok === null) return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
      — {label}
    </span>
  )
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${ok ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

function FundCard({ ticker, fund }) {
  const label    = ticker.replace('.pl', '').toUpperCase()
  const currency = fund?.currency ?? (ticker.endsWith('.pl') ? 'PLN' : 'USD')
  const c        = criteriaCheck({ ...fund, _ticker: ticker })
  const hasSignal = c.yieldOk && c.payoutOk !== false && c.peOk !== false && c.dataOk

  const yieldPct    = fund?.dividendYield   != null ? (fund.dividendYield * 100).toFixed(1) : null
  const payoutPct   = fund?.payoutRatio     != null ? Math.round(fund.payoutRatio * 100)    : null
  const pe          = fund?.forwardPE ?? fund?.trailingPE
  const days        = daysToExDividend(fund?.exDividendDate)

  return (
    <div className={`bg-gpw-card border rounded-lg p-4 space-y-3 ${hasSignal ? 'border-green-600' : 'border-gpw-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-bold text-base">{label}</span>
            <span className="text-sm text-gray-400 truncate">
              {fund?.shortName ?? COMPANY_NAMES[ticker.toLowerCase()] ?? COMPANY_NAMES[ticker] ?? ''}
            </span>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${hasSignal ? 'bg-green-800 text-green-200' : 'bg-gpw-dark text-gray-400'}`}>
          {hasSignal ? '💰 SYGNAŁ' : '👁 OBSERWUJ'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className={`rounded p-2 text-center ${c.yieldOk ? 'bg-green-900/30' : 'bg-gpw-dark'}`}>
          <div className={`font-bold ${c.yieldOk ? 'text-green-400' : 'text-gray-300'}`}>
            {yieldPct != null ? `${yieldPct}%` : '—'}
          </div>
          <div className="text-xs text-gray-400">Yield</div>
        </div>
        <div className={`rounded p-2 text-center ${c.payoutOk ? 'bg-green-900/30' : 'bg-red-900/20'}`}>
          <div className={`font-bold ${c.payoutOk ? 'text-green-400' : 'text-red-400'}`}>
            {payoutPct != null ? `${payoutPct}%` : '—'}
          </div>
          <div className="text-xs text-gray-400">Payout</div>
        </div>
        <div className={`rounded p-2 text-center ${c.peOk ? 'bg-green-900/30' : 'bg-red-900/20'}`}>
          <div className={`font-bold ${c.peOk ? 'text-green-400' : 'text-red-400'}`}>
            {pe != null ? pe.toFixed(1) : '—'}
          </div>
          <div className="text-xs text-gray-400">P/E</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <CriterionDot ok={c.yieldOk}  label="Yield≥3%" />
        <CriterionDot ok={c.payoutOk} label="Payout<70%" />
        <CriterionDot ok={c.peOk}     label="P/E ok" />
        <CriterionDot ok={c.dataOk}   label="Dane" />
      </div>

      <div className="text-xs text-gray-400 flex gap-3 flex-wrap">
        {fund?.price != null && <span>Kurs: {fund.price} {currency}</span>}
        {fund?.exDividendDate && (
          <span className={days != null && days <= 10 && days >= 0 ? 'text-yellow-400' : ''}>
            📅 Ex-div: {fund.exDividendDate}
            {days != null && days >= 0 && ` (za ${days} dni)`}
          </span>
        )}
      </div>
    </div>
  )
}

export default function DividendSignals() {
  const { exchange } = useExchange()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const tickers = DIVIDEND_UNIVERSE[exchange] ?? []

    Promise.allSettled(
      tickers.map(ticker =>
        fetch(`/api/market?mode=fundamentals&ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
          .then(fund => ({ ticker, fund }))
      )
    ).then(results => {
      setRows(
        results
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value)
          .sort((a, b) => {
            const ca = criteriaCheck({ ...a.fund, _ticker: a.ticker })
            const cb = criteriaCheck({ ...b.fund, _ticker: b.ticker })
            const sa = (ca.yieldOk ? 4 : 0) + (ca.payoutOk ? 2 : 0) + (ca.peOk ? 1 : 0)
            const sb = (cb.yieldOk ? 4 : 0) + (cb.payoutOk ? 2 : 0) + (cb.peOk ? 1 : 0)
            return sb - sa
          })
      )
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [exchange])

  if (loading) return <p className="text-gray-400 text-sm">Ładowanie danych fundamentalnych…</p>
  if (error)   return <p className="text-red-400 text-sm">Błąd: {error}</p>
  if (!rows.length) return <p className="text-gray-400 text-sm">Brak danych dla {exchange}.</p>

  const signalCount = rows.filter(({ ticker, fund }) => {
    const c = criteriaCheck({ ...fund, _ticker: ticker })
    return c.yieldOk && c.payoutOk !== false && c.peOk !== false && c.dataOk
  }).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        {exchange} · {signalCount > 0 ? `${signalCount} aktywny sygnał` : 'brak aktywnych sygnałów'} · {rows.length} spółek w universum
      </p>
      {rows.map(({ ticker, fund }) => (
        <FundCard key={ticker} ticker={ticker} fund={fund} />
      ))}
    </div>
  )
}
