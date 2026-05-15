import { useState } from 'react'

const DECISION_STYLE = {
  'WEJDŹ':   { icon: '✅', cls: 'text-gpw-green'  },
  'OBSERWUJ':{ icon: '⏳', cls: 'text-yellow-400' },
  'UNIKAJ':  { icon: '❌', cls: 'text-gpw-red'    },
}

function BuffettMeter({ score }) {
  const filled = Math.min(10, Math.max(0, score))
  const color  = filled >= 8 ? 'bg-gpw-green' : filled >= 5 ? 'bg-yellow-400' : 'bg-gpw-red'
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`w-2.5 h-2.5 rounded-sm ${i < filled ? color : 'bg-gpw-border'}`} />
        ))}
      </div>
      <span className="text-xs font-bold text-gray-300">{filled}/10</span>
    </div>
  )
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
    } catch {
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
        className="bg-gpw-dark border border-gpw-border rounded-xl w-full max-w-sm flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div className="p-4 border-b border-gpw-border flex justify-between items-start shrink-0">
          <div>
            <span className="font-bold text-lg">{rec.tickerDisplay}</span>
            {rec.companyName && <span className="text-xs text-gray-500 ml-1.5">({rec.companyName})</span>}
            <div className="text-xs text-gray-400 mt-0.5">{rec.signal ?? strategy} · {rec.price} {currency}</div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
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
                🤖 Analizuj z AI (Buffett/Lynch)
              </button>
            </>
          )}

          {state === 'loading' && (
            <div className="text-center py-8 space-y-2">
              <div className="text-sm text-gray-400 animate-pulse">Analizuję z Claude AI…</div>
              <div className="text-xs text-gray-600">Sprawdzam 10 punktów checklisty Buffetta</div>
            </div>
          )}

          {state === 'result' && result && (
            <div className="space-y-3">
              {/* Decision header */}
              <div className="bg-gpw-card rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className={`text-xl font-bold ${ds.cls}`}>{ds.icon} {result.decision}</span>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Pewność AI</div>
                    <div className="text-sm font-bold text-white">{result.confidence}%</div>
                  </div>
                </div>
                <div className="bg-gpw-border rounded-full h-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${result.confidence >= 70 ? 'bg-gpw-green' : result.confidence >= 50 ? 'bg-yellow-500' : 'bg-gpw-red'}`}
                    style={{ width: `${result.confidence}%` }}
                  />
                </div>
                {result.buffettScore != null && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-400">Wynik Buffetta</div>
                    <BuffettMeter score={result.buffettScore} />
                    <div className="text-xs text-gray-500">
                      {result.buffettScore >= 8 ? 'Silna okazja fundamentalna'
                        : result.buffettScore >= 5 ? 'Potencjał, ale ryzyka'
                        : 'Słabe fundamenty — ostrożnie'}
                    </div>
                  </div>
                )}
                {result.summary && (
                  <p className="text-xs text-yellow-300 leading-relaxed border-t border-gpw-border pt-2">
                    💡 {result.summary}
                  </p>
                )}
              </div>

              {/* Checklist analysis */}
              {result.analysis && (
                <div className="bg-gpw-card border border-gpw-border rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">📋 Analiza Buffetta</p>
                  <pre className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">{result.analysis}</pre>
                </div>
              )}

              {/* Plan działania */}
              {result.recommendation && (
                <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
                    {result.decision === 'UNIKAJ' ? '🚫 Dlaczego unikać' : '🎯 Plan wejścia'}
                  </p>
                  <pre className="text-sm text-white leading-relaxed whitespace-pre-wrap font-sans">{result.recommendation}</pre>
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
        </div>

        {/* Footer — fixed */}
        <div className="p-3 border-t border-gpw-border shrink-0">
          <p className="text-xs text-gray-500 text-center">⚠️ Analiza edukacyjna AI — nie jest poradą inwestycyjną.</p>
        </div>
      </div>
    </div>
  )
}
