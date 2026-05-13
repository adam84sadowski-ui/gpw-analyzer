import { nextReviewDate } from '../../../strategies/gem.js'

const ETF_META = {
  CSPX: { flag: '🇺🇸', label: 'USA',        color: 'text-blue-400' },
  SWRD: { flag: '🌍', label: 'Świat',       color: 'text-green-400' },
  AGGH: { flag: '🛡️', label: 'Obligacje',  color: 'text-yellow-400' },
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(new Date().toISOString().slice(0, 10))
  const target = new Date(dateStr)
  return Math.round((target - today) / 86400000)
}

export default function GEMDecisionCard({ decision }) {
  if (!decision) {
    return (
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-5 space-y-2">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">🌍 GEM — Decyzja miesięczna</div>
        <p className="text-sm text-gray-400">Brak danych — algorytm zostanie uruchomiony przy pierwszym przeglądzie miesięcznym.</p>
      </div>
    )
  }

  const meta       = ETF_META[decision.etf] ?? { flag: '?', label: decision.etf, color: 'text-white' }
  const reviewDate = nextReviewDate(new Date(decision.timestamp))
  const days       = daysUntil(reviewDate)
  const isRotation = false  // determined at time of signal
  const actionLabel = decision.decision === 'bonds' ? '🛡️ KUP / TRZYMAJ' : '📌 KUP / TRZYMAJ'

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-lg p-5 space-y-4">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">🌍 GEM — Decyzja miesięczna</div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs text-gray-500 mb-1">{actionLabel}</div>
          <div className={`text-3xl font-bold ${meta.color}`}>{decision.etf}</div>
          <div className="text-sm text-gray-300 mt-0.5">{decision.etfName}</div>
          <div className="text-xs text-gray-500 mt-1">{meta.flag} {meta.label}</div>
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-500">Następny przegląd</div>
          <div className="text-sm text-white font-medium">
            {new Date(reviewDate).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          {days != null && (
            <div className={`text-xs mt-0.5 ${days <= 7 ? 'text-yellow-400' : 'text-gray-400'}`}>
              ⏳ za {days} {days === 1 ? 'dzień' : 'dni'}
            </div>
          )}
        </div>
      </div>

      <a
        href="https://xstation5.xtb.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs bg-gpw-dark hover:bg-gpw-border text-gray-300 hover:text-white px-3 py-1.5 rounded transition-colors"
      >
        📱 Otwórz XTB → {decision.etf}
      </a>

      {decision.timestamp && (
        <div className="text-xs text-gray-600">
          Ostatni przegląd: {new Date(decision.timestamp).toLocaleDateString('pl-PL')}
        </div>
      )}
    </div>
  )
}
