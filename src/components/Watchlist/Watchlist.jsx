import { useState, useEffect } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'

function zoneStatus(item) {
  if (!item.livePrice) return null
  if (item.entryZoneMin != null && item.entryZoneMax != null) {
    if (item.livePrice >= item.entryZoneMin && item.livePrice <= item.entryZoneMax) return 'in'
    if (item.livePrice < item.entryZoneMin) return 'below'
    return 'above'
  }
  return null
}

function WatchCard({ item, onDelete }) {
  const status = item.status === 'expired' ? 'expired' : zoneStatus(item)
  const currency = item.exchange === 'NYSE' ? 'USD' : 'PLN'
  const display = item.exchange === 'NYSE'
    ? item.ticker.toUpperCase()
    : item.ticker.replace('.pl', '').toUpperCase()

  const statusBadge = {
    in:      { label: '✅ W strefie', cls: 'text-gpw-green border-gpw-green/40 bg-gpw-green/10' },
    below:   { label: '📉 Poniżej strefy', cls: 'text-blue-400 border-blue-400/40 bg-blue-400/10' },
    above:   { label: '⬆️ Powyżej strefy', cls: 'text-gray-400 border-gray-600 bg-transparent' },
    expired: { label: '⏰ Wygasło', cls: 'text-gray-500 border-gray-700 bg-transparent' },
    null:    { label: '—', cls: 'text-gray-500 border-gray-700 bg-transparent' },
  }[status ?? 'null']

  return (
    <div className={`bg-gpw-card border rounded-xl p-4 space-y-3 ${item.status === 'expired' ? 'opacity-50 border-gpw-border' : 'border-gpw-border'}`}>
      <div className="flex justify-between items-start">
        <div>
          <span className="font-bold text-base">{display}</span>
          <span className="text-xs text-gray-500 ml-1.5">{item.exchange} · {item.strategy}</span>
          <div className="text-xs text-gray-500 mt-0.5">
            Analiza: {item.priceAtAnalysis} {currency} · {new Date(item.createdAt).toLocaleDateString('pl-PL')}
          </div>
        </div>
        <button onClick={() => onDelete(item.id)} className="text-gray-600 hover:text-gpw-red text-lg leading-none transition-colors">✕</button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>
        {item.livePrice && (
          <span className="text-sm font-bold text-white">{item.livePrice} {currency}</span>
        )}
      </div>

      {(item.entryZoneMin != null || item.entryZoneMax != null) && (
        <div className="bg-gpw-dark rounded-lg p-2 text-xs text-gray-300">
          🎯 Strefa wejścia: <span className="font-bold text-yellow-300">
            {item.entryZoneMin ?? '?'} – {item.entryZoneMax ?? '?'} {currency}
          </span>
          {item.stopLoss && <span className="ml-2 text-gray-500">· Stop -{item.stopLoss}%</span>}
          {item.target && <span className="ml-1 text-gray-500">· Cel +{item.target}%</span>}
        </div>
      )}

      {item.aiSummary && (
        <p className="text-xs text-yellow-300/80 leading-relaxed">💡 {item.aiSummary}</p>
      )}

      {item.reviewDate && item.status !== 'expired' && (
        <div className="text-xs text-gray-500">
          Przegląd: {new Date(item.reviewDate).toLocaleDateString('pl-PL')}
        </div>
      )}
    </div>
  )
}

export default function Watchlist() {
  const { exchange } = useExchange()
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/watchlist')
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }

  async function remove(id) {
    await fetch('/api/watchlist', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    })
    setItems(prev => prev.filter(w => w.id !== id))
  }

  useEffect(() => { load() }, [])

  const active  = items.filter(w => w.status === 'active')
  const expired = items.filter(w => w.status === 'expired')

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm animate-pulse">Ładowanie obserwowanych…</div>

  if (items.length === 0) return (
    <div className="text-center py-12 space-y-2">
      <div className="text-4xl">👁️</div>
      <p className="text-gray-400 text-sm">Brak obserwowanych spółek.</p>
      <p className="text-gray-600 text-xs">Gdy AI powie OBSERWUJ, naciśnij 💾 Zapisz do obserwowanych.</p>
    </div>
  )

  return (
    <div className="space-y-4 pb-6">
      {active.length > 0 && (
        <div className="space-y-3">
          {active.map(w => <WatchCard key={w.id} item={w} onDelete={remove} />)}
        </div>
      )}

      {expired.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600 uppercase tracking-wide px-1">Wygasłe</p>
          {expired.map(w => <WatchCard key={w.id} item={w} onDelete={remove} />)}
        </div>
      )}
    </div>
  )
}
