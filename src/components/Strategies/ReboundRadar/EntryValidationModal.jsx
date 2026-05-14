import { useState } from 'react'

const DECISION_STYLE = {
  'WEJDŹ':    { icon: '✅', cls: 'text-gpw-green' },
  'POCZEKAJ': { icon: '⏳', cls: 'text-yellow-400' },
  'ODRZUĆ':   { icon: '❌', cls: 'text-gpw-red'   },
}
const RISK_STYLE = {
  'NISKIE':      'text-gpw-green',
  'UMIARKOWANE': 'text-yellow-400',
  'WYSOKIE':     'text-gpw-red',
}

export default function EntryValidationModal({ rec, strategy, exchange, onOpenPosition, onClose }) {
  const [state,  setState]  = useState('idle') // idle | loading | result
  const [result, setResult] = useState(null)
  const [error,  setError]  = useState(null)
  const currency = exchange === 'NYSE' ? 'USD' : 'PLN'

  const sma50Delta = rec.sma50 && rec.price
    ? ((rec.price - rec.sma50) / rec.sma50 * 100).toFixed(1)
    : 0

  async function validate() {
    setState('loading')
    setError(null)
    try {
      const params = new URLSearchParams({
        mode:       'ai-validate',
        ticker:     rec.ticker,
        exchange,
        signal:     rec.signal ?? '',
        score:      rec.score   ?? 0,
        rsi:        rec.rsi     ?? 50,
        volMult:    rec.volMult ?? 1,
        sma50Delta,
      })
      const res  = await fetch(`/api/market?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
      setState('result')
    } catch (e) {
      setError('Błąd AI — spróbuj ponownie.')
      setState('idle')
    }
  }

  const ds = DECISION_STYLE[result?.decision] ?? { icon: '—', cls: 'text-gray-400' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 px-3 pb-4 sm:pb-0"
      onClick={onClose}
    >
      <div
        className="bg-gpw-dark border border-gpw-border rounded-xl w-full max-w-sm p-4 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <span className="font-bold text-lg">{rec.tickerDisplay}</span>
            {rec.companyName && <span className="text-xs text-gray-500 ml-1.5">({rec.companyName})</span>}
            <div className="text-xs text-gray-400 mt-0.5">{rec.signal ?? strategy} · {rec.price} {currency}</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Indicators grid */}
        <div className="grid grid-cols-3 gap-2 text-xs text-center">
          <div className="bg-gpw-card rounded p-2">
            <div className="text-gray-400">RSI</div>
            <div className="font-bold">{rec.rsi?.toFixed(1) ?? '—'}</div>
          </div>
          <div className="bg-gpw-card rounded p-2">
            <div className="text-gray-400">Score</div>
            <div className="font-bold">{rec.score ?? '—'}/100</div>
          </div>
          <div className="bg-gpw-card rounded p-2">
            <div className="text-gray-400">Wolumen</div>
            <div className="font-bold">{rec.volMult != null ? `${rec.volMult}x` : '—'}</div>
          </div>
        </div>

        {/* CTA / result */}
        {state === 'idle' && (
          <>
            {error && <p className="text-xs text-gpw-red text-center">{error}</p>}
            <button
              onClick={validate}
              className="w-full bg-gpw-blue hover:bg-blue-600 text-white py-3 rounded-lg font-semibold transition-colors"
            >
              🤖 Zwaliduj z AI
            </button>
          </>
        )}

        {state === 'loading' && (
          <div className="text-center py-5 text-sm text-gray-400 animate-pulse">
            Analizuję z Claude AI…
          </div>
        )}

        {state === 'result' && result && (
          <div className="space-y-3">
            {/* Decision + risk + confidence */}
            <div className="bg-gpw-card rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className={`text-xl font-bold ${ds.cls}`}>{ds.icon} {result.decision}</span>
                <span className={`text-sm font-semibold ${RISK_STYLE[result.risk] ?? 'text-gray-400'}`}>
                  Ryzyko: {result.risk}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                Pewność AI: <span className="text-white font-bold">{result.confidence}%</span>
                <div className="mt-1 bg-gpw-border rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      result.confidence >= 70 ? 'bg-gpw-green'
                      : result.confidence >= 50 ? 'bg-yellow-500'
                      : 'bg-gpw-red'
                    }`}
                    style={{ width: `${result.confidence}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">{result.reason}</p>
            </div>

            {/* Recommendation box */}
            {result.recommendation && (
              <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3">
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1.5">📋 Plan działania</p>
                <p className="text-sm text-white leading-relaxed">{result.recommendation}</p>
              </div>
            )}

            {result.decision === 'WEJDŹ' ? (
              <button
                onClick={() => { onClose(); onOpenPosition(rec, result) }}
                className="w-full bg-gpw-green hover:bg-green-600 text-white py-3 rounded-lg font-semibold transition-colors"
              >
                ✅ Realizuję wejście
              </button>
            ) : (
              <button
                onClick={validate}
                className="w-full bg-gpw-card text-gray-400 hover:text-white py-2 rounded-lg text-sm transition-colors"
              >
                🔄 Sprawdź ponownie
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-gray-500 text-center">⚠️ Analiza edukacyjna AI — nie jest poradą inwestycyjną.</p>
      </div>
    </div>
  )
}
