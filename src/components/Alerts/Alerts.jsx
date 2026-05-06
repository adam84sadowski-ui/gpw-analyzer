import { useState, useEffect } from 'react'

const STRATEGY_LABEL = { scalping: '⚡ Scalping', swing: '📈 Swing', aggressive: '🚀 Agresywna' }
const SIGNAL_COLOR   = { RSI_OVERSOLD: 'text-gpw-green', SMA50_CROSSOVER: 'text-blue-400', BREAKOUT: 'text-red-400' }

export default function Alerts() {
  const [alerts,   setAlerts]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState({ ticker: '', strategy: '' })

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '50' })
    if (filter.strategy) params.set('strategy', filter.strategy)
    if (filter.ticker)   params.set('ticker',   filter.ticker)
    fetch(`/api/alerts?${params}`)
      .then(r => r.json())
      .then(data => setAlerts(Array.isArray(data) ? data : []))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false))
  }, [filter.strategy, filter.ticker])

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <input
          placeholder="Spółka (np. PKN)"
          value={filter.ticker}
          onChange={e => setFilter(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
          className="bg-gpw-card border border-gpw-border rounded px-3 py-1.5 text-sm w-32"
        />
        <select
          value={filter.strategy}
          onChange={e => setFilter(f => ({ ...f, strategy: e.target.value }))}
          className="bg-gpw-card border border-gpw-border rounded px-3 py-1.5 text-sm"
        >
          <option value="">Wszystkie strategie</option>
          <option value="scalping">Scalping</option>
          <option value="swing">Swing</option>
          <option value="aggressive">Agresywna</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Ładowanie alertów…</div>
      ) : alerts.length === 0 ? (
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-8 text-center text-gray-400">
          Brak alertów. Alerty pojawią się gdy strategie wykryją sygnały.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(a => {
            const currency = a.exchange === 'NYSE' ? 'USD' : 'PLN'
            const date     = new Date(a.timestamp)
            return (
              <div key={a.id} className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-1">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{(a.ticker ?? '').replace(/\.pl$/i, '').toUpperCase()}</span>
                    <span className="text-xs text-gray-500">{STRATEGY_LABEL[a.strategy] ?? a.strategy}</span>
                    <span className={`text-xs font-semibold ${SIGNAL_COLOR[a.signal] ?? 'text-white'}`}>{a.signal}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {date.toLocaleDateString('pl-PL')} {date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {a.price != null && (
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>Cena: <span className="text-white">{a.price} {currency}</span></span>
                    {a.target    != null && <span>Cel: <span className="text-gpw-green">+{a.target}%</span></span>}
                    {a.stopLoss  != null && <span>Stop: <span className="text-gpw-red">-{a.stopLoss}%</span></span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
