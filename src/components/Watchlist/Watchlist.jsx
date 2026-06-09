import { useState, useEffect } from 'react'
import EntryValidationModal from '../Strategies/ReboundRadar/EntryValidationModal.jsx'

function zoneStatus(item) {
  if (!item.livePrice) return null
  if (item.entryZoneMin != null && item.entryZoneMax != null) {
    if (item.livePrice >= item.entryZoneMin && item.livePrice <= item.entryZoneMax) return 'in'
    if (item.livePrice < item.entryZoneMin) return 'below'
    return 'above'
  }
  return null
}

function WatchCard({ item, onDelete, onPositionOpened, onValidate }) {
  const [confirming, setConfirming] = useState(false)
  const [opening,    setOpening]    = useState(false)

  const status  = item.status === 'expired' ? 'expired' : zoneStatus(item)
  const currency = item.exchange === 'NYSE' ? 'USD' : 'PLN'
  const display  = item.exchange === 'NYSE'
    ? item.ticker.toUpperCase()
    : item.ticker.replace('.pl', '').toUpperCase()

  const STATUS = {
    in:      { label: '✅ W strefie wejścia', cls: 'text-gpw-green border-gpw-green/40 bg-gpw-green/10' },
    below:   { label: '📉 Poniżej strefy', cls: 'text-blue-400 border-blue-400/40 bg-blue-400/10' },
    above:   { label: '⬆️ Powyżej strefy', cls: 'text-gray-400 border-gray-600 bg-transparent' },
    expired: { label: '⏰ Wygasło', cls: 'text-gray-500 border-gray-700 bg-transparent' },
    null:    { label: '—', cls: 'text-gray-500 border-gray-700 bg-transparent' },
  }[status ?? 'null']

  async function openPosition() {
    setOpening(true)
    try {
      const settings = await fetch('/api/market?mode=scan&strategy=scalping&exchange=GPW')
        .then(() => null).catch(() => null)
      const portfolio  = 10000
      const positionSize = Math.round(portfolio * 0.10)
      const entryPrice   = item.livePrice ?? item.priceAtAnalysis
      await fetch('/api/positions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker:      item.ticker,
          strategy:    item.strategy,
          exchange:    item.exchange,
          entryPrice,
          positionSize,
          target:      item.target,
          stopLoss:    item.stopLoss,
          signal:      item.signal,
          entryRsi:    item.rsi    ?? null,
          entryScore:  item.score  ?? null,
          entryVolMult: item.volMult ?? null,
        }),
      })
      await fetch('/api/positions?mode=watchlist', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: item.id }),
      })
      onPositionOpened(item.id)
    } catch { /* silent */ }
    setOpening(false)
    setConfirming(false)
  }

  const isExpired = item.status === 'expired'

  return (
    <div className={`bg-gpw-card border rounded-xl p-4 space-y-3 ${isExpired ? 'opacity-50 border-gpw-border' : 'border-gpw-border'}`}>
      {/* Header */}
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

      {/* Status + live price */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS.cls}`}>{STATUS.label}</span>
        {item.livePrice && (
          <span className="text-sm font-bold text-white">{item.livePrice} {currency}</span>
        )}
      </div>

      {/* Indicators grid */}
      <div className="grid grid-cols-4 gap-1.5 text-xs text-center">
        {[
          { label: 'RSI', val: item.rsi != null ? item.rsi.toFixed(1) : '—' },
          { label: 'Wolumen', val: item.volMult != null ? `${item.volMult}x` : '—' },
          { label: 'Score', val: item.score != null ? `${item.score}/100` : '—' },
          { label: 'AI', val: item.buffettScore != null ? `${item.buffettScore}/10` : '—' },
        ].map(({ label, val }) => (
          <div key={label} className="bg-gpw-dark rounded p-1.5">
            <div className="text-gray-500 text-[10px]">{label}</div>
            <div className="font-bold text-gray-200">{val}</div>
          </div>
        ))}
      </div>

      {/* Entry zone */}
      {(item.entryZoneMin != null || item.entryZoneMax != null) && (
        <div className="bg-gpw-dark rounded-lg p-2 text-xs text-gray-300">
          🎯 Strefa wejścia: <span className="font-bold text-yellow-300">
            {item.entryZoneMin ?? '?'} – {item.entryZoneMax ?? '?'} {currency}
          </span>
          {item.stopLoss && <span className="ml-2 text-gray-500">Stop -{item.stopLoss}%</span>}
          {item.target    && <span className="ml-1 text-gray-500">Cel +{item.target}%</span>}
        </div>
      )}

      {/* AI summary */}
      {item.aiSummary && (
        <p className="text-xs text-yellow-300/80 leading-relaxed">💡 {item.aiSummary}</p>
      )}

      {item.reviewDate && !isExpired && (
        <div className="text-xs text-gray-500">Przegląd: {new Date(item.reviewDate).toLocaleDateString('pl-PL')}</div>
      )}

      {/* Actions */}
      {!isExpired && (
        <div className="space-y-2 pt-1">
          {/* Validate button */}
          <button
            onClick={() => onValidate(item)}
            className="w-full bg-gpw-blue/20 hover:bg-gpw-blue/40 border border-gpw-blue/40 text-blue-300 py-2 rounded-lg text-xs font-medium transition-colors"
          >
            🤖 Waliduj z AI (aktualny kurs)
          </button>

          {/* Open position */}
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className={`w-full py-2 rounded-lg text-xs font-medium transition-colors border ${
                status === 'in'
                  ? 'bg-gpw-green/20 hover:bg-gpw-green/40 border-gpw-green/40 text-gpw-green'
                  : 'bg-gpw-card hover:bg-gpw-border border-gpw-border text-gray-400 hover:text-white'
              }`}
            >
              {status === 'in' ? '✅ Otwórz pozycję (w strefie)' : '📌 Wejdź teraz (poza strefą)'}
            </button>
          ) : (
            <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-300">
                Otwórz pozycję: <span className="font-bold text-white">{display}</span> po{' '}
                <span className="font-bold text-yellow-300">{item.livePrice ?? item.priceAtAnalysis} {currency}</span>
              </p>
              <div className="flex gap-2">
                <button
                  disabled={opening}
                  onClick={openPosition}
                  className="flex-1 bg-gpw-green hover:bg-green-600 disabled:opacity-50 text-white py-1.5 rounded text-xs font-semibold transition-colors"
                >
                  {opening ? 'Otwieranie…' : '✅ Potwierdź'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 bg-gpw-card text-gray-400 hover:text-white py-1.5 rounded text-xs transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Watchlist() {
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modalRec, setModalRec] = useState(null)
  const [modalStrategy, setModalStrategy] = useState(null)
  const [modalExchange, setModalExchange] = useState(null)
  const [validating, setValidating] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/positions?mode=watchlist')
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }

  async function remove(id) {
    await fetch('/api/positions?mode=watchlist', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    })
    setItems(prev => prev.filter(w => w.id !== id))
  }

  async function handleValidate(item) {
    setValidating(item.id)
    try {
      const params = new URLSearchParams({
        mode: 'indicators', ticker: item.ticker,
        exchange: item.exchange, strategy: item.strategy,
      })
      const res  = await fetch(`/api/market?${params}`)
      const data = await res.json()
      const display = item.exchange === 'NYSE'
        ? item.ticker.toUpperCase()
        : item.ticker.replace('.pl', '').toUpperCase()
      setModalRec({
        ticker:       item.ticker,
        tickerDisplay: display,
        signal:       item.signal ?? '',
        price:        item.livePrice ?? item.priceAtAnalysis,
        livePrice:    item.livePrice,
        rsi:          data.rsi,
        volMult:      data.volMult,
        score:        data.score,
        sma50:        data.sma50,
        stopLoss:     item.stopLoss,
        target:       item.target,
      })
      setModalStrategy(item.strategy)
      setModalExchange(item.exchange)
    } catch { /* silent */ }
    setValidating(null)
  }

  useEffect(() => { load() }, [])

  const active  = items.filter(w => w.status === 'active')
  const expired = items.filter(w => w.status === 'expired')

  if (loading) return (
    <div className="text-center py-12 text-gray-500 text-sm animate-pulse">Ładowanie obserwowanych…</div>
  )

  if (items.length === 0) return (
    <div className="text-center py-12 space-y-2">
      <div className="text-4xl">👁️</div>
      <p className="text-gray-400 text-sm">Brak obserwowanych spółek.</p>
      <p className="text-gray-600 text-xs">Gdy AI powie OBSERWUJ, naciśnij 💾 Zapisz do obserwowanych.</p>
    </div>
  )

  return (
    <>
      <div className="space-y-4 pb-6">
        {active.length > 0 && (
          <div className="space-y-3">
            {active.map(w => (
              <WatchCard
                key={w.id}
                item={w}
                onDelete={remove}
                onPositionOpened={id => setItems(prev => prev.filter(x => x.id !== id))}
                onValidate={handleValidate}
              />
            ))}
          </div>
        )}

        {expired.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-600 uppercase tracking-wide px-1">Wygasłe</p>
            {expired.map(w => (
              <WatchCard
                key={w.id}
                item={w}
                onDelete={remove}
                onPositionOpened={id => setItems(prev => prev.filter(x => x.id !== id))}
                onValidate={handleValidate}
              />
            ))}
          </div>
        )}

        {validating && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
            <p className="text-white text-sm animate-pulse">Pobieranie wskaźników…</p>
          </div>
        )}
      </div>

      {modalRec && (
        <EntryValidationModal
          rec={modalRec}
          strategy={modalStrategy}
          exchange={modalExchange}
          livePrice={modalRec.livePrice}
          onOpenPosition={() => {}}
          onClose={() => { setModalRec(null); load() }}
        />
      )}
    </>
  )
}
