import { useState } from 'react'

const MOCK_ALERTS = []

export default function Alerts() {
  const [filter, setFilter] = useState({ ticker: '', strategy: '', status: '' })
  const alerts = MOCK_ALERTS

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
        <select
          value={filter.status}
          onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          className="bg-gpw-card border border-gpw-border rounded px-3 py-1.5 text-sm"
        >
          <option value="">Wszystkie statusy</option>
          <option value="open">W toku</option>
          <option value="hit">Cel osiągnięty</option>
          <option value="stop">Stop loss</option>
        </select>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-8 text-center text-gray-400">
          Brak alertów. Alerty pojawią się gdy strategie wykryją sygnały.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(a => (
            <div key={a.id} className="bg-gpw-card border border-gpw-border rounded-lg p-4">
              <div className="flex justify-between">
                <span className="font-bold">{a.ticker}</span>
                <span className="text-sm text-gray-400">{a.date}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
