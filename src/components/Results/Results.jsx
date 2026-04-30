import { useState, useEffect, useCallback } from 'react'

function pct(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function pln(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)} PLN` }

function CloseModal({ position, onClose, onConfirm }) {
  const [exitPrice, setExitPrice] = useState(String(position.entryPrice))
  const pnlPct = ((Number(exitPrice) - position.entryPrice) / position.entryPrice * 100).toFixed(2)
  const pnlPln = ((Number(exitPrice) - position.entryPrice) * position.shares).toFixed(2)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gpw-card border border-gpw-border rounded-xl p-6 w-full max-w-sm space-y-4">
        <h3 className="font-semibold text-lg">Zamknij pozycję — {position.tickerDisplay}</h3>
        <div className="text-sm text-gray-400">Cena wejścia: <span className="text-white">{position.entryPrice} PLN</span></div>
        <label className="block">
          <span className="text-sm text-gray-400">Cena wyjścia (PLN)</span>
          <input
            type="number"
            step="0.01"
            value={exitPrice}
            onChange={e => setExitPrice(e.target.value)}
            className="mt-1 w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          />
        </label>
        <div className={`text-center text-lg font-bold ${Number(pnlPln) >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
          {pct(Number(pnlPct))} / {pln(Number(pnlPln))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-gpw-dark border border-gpw-border py-2 rounded-lg text-sm">Anuluj</button>
          <button
            onClick={() => onConfirm(Number(exitPrice))}
            className="flex-1 bg-gpw-green hover:bg-green-600 text-white py-2 rounded-lg text-sm font-semibold"
          >
            Potwierdź zamknięcie
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Results() {
  const [tab, setTab]               = useState('open')
  const [positions, setPositions]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [prices, setPrices]         = useState({})
  const [closing, setClosing]       = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/positions?status=${tab}`)
      .then(r => r.json())
      .then(async data => {
        setPositions(data)
        if (tab === 'open' && data.length > 0) {
          const uniqueTickers = [...new Set(data.map(p => p.ticker))]
          const priceMap = {}
          await Promise.all(uniqueTickers.map(async ticker => {
            try {
              const r = await fetch(`/api/stooq?ticker=${ticker}&type=current`)
              const d = await r.json()
              if (d?.close) priceMap[ticker] = d.close
            } catch {}
          }))
          setPrices(priceMap)
        }
      })
      .catch(() => setPositions([]))
      .finally(() => setLoading(false))
  }, [tab])

  useEffect(() => { load() }, [load])

  async function closePosition(exitPrice) {
    await fetch('/api/positions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: closing.id, exitPrice }),
    })
    setClosing(null)
    load()
  }

  const openPositions  = positions.filter(p => p.status === 'open')
  const closedPositions = positions.filter(p => p.status === 'closed')

  const totalInvested  = openPositions.reduce((s, p) => s + p.positionSize, 0)
  const totalPnL       = openPositions.reduce((s, p) => {
    const cur = prices[p.ticker]
    if (!cur) return s
    return s + (cur - p.entryPrice) * p.shares
  }, 0)

  const portfolio = (() => {
    try { return JSON.parse(localStorage.getItem('gpw_settings') ?? '{}').capital ?? 10000 }
    catch { return 10000 }
  })()

  return (
    <div className="space-y-4">
      {closing && <CloseModal position={closing} onClose={() => setClosing(null)} onConfirm={closePosition} />}

      {/* Podsumowanie */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
          <div className="text-xs text-gray-400 mb-1">Portfel</div>
          <div className="font-bold">{portfolio.toLocaleString('pl-PL')} PLN</div>
        </div>
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
          <div className="text-xs text-gray-400 mb-1">Zainwestowane</div>
          <div className="font-bold">{totalInvested.toLocaleString('pl-PL')} PLN</div>
        </div>
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
          <div className="text-xs text-gray-400 mb-1">P&L (otwarte)</div>
          <div className={`font-bold ${totalPnL >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
            {pln(totalPnL)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gpw-border">
        {[['open', 'Aktywne'], ['closed', 'Zamknięte']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === id ? 'border-gpw-blue text-white' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {label}
            {id === 'open' && openPositions.length > 0 && (
              <span className="ml-1.5 bg-gpw-blue text-white text-xs px-1.5 rounded-full">
                {openPositions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Ładowanie…</div>
      ) : positions.length === 0 ? (
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-8 text-center text-gray-400 text-sm">
          {tab === 'open'
            ? 'Brak aktywnych pozycji. Potwierdź rekomendację w zakładce Strategie.'
            : 'Brak zamkniętych pozycji.'}
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map(pos => {
            const cur    = prices[pos.ticker]
            const pnlPct = cur ? ((cur - pos.entryPrice) / pos.entryPrice * 100) : null
            const pnlPln = cur ? ((cur - pos.entryPrice) * pos.shares) : null

            return (
              <div key={pos.id} className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-bold text-lg">{pos.tickerDisplay}</span>
                    <span className="ml-2 text-xs text-gray-400">{pos.strategy}</span>
                  </div>
                  <div className="text-right">
                    {pos.status === 'open' && cur && (
                      <div className={`font-bold text-lg ${pnlPct >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                        {pct(pnlPct)}
                      </div>
                    )}
                    {pos.status === 'closed' && (
                      <div className={`font-bold text-lg ${pos.pnlPct >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                        {pct(pos.pnlPct)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="bg-gpw-dark rounded p-1.5">
                    <div className="text-gray-400">Wejście</div>
                    <div className="font-bold">{pos.entryPrice} PLN</div>
                  </div>
                  <div className="bg-gpw-dark rounded p-1.5">
                    <div className="text-gray-400">{pos.status === 'open' ? 'Teraz' : 'Wyjście'}</div>
                    <div className="font-bold">{pos.status === 'open' ? (cur ?? '…') : pos.exitPrice} PLN</div>
                  </div>
                  <div className="bg-gpw-dark rounded p-1.5">
                    <div className="text-gray-400">Wartość P&L</div>
                    <div className={`font-bold ${(pnlPln ?? pos.pnlPln ?? 0) >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                      {pln(pnlPln ?? pos.pnlPln ?? 0)}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between text-xs text-gray-500">
                  <span>Akcji: {pos.shares} × {pos.entryPrice} PLN = {pos.positionSize.toLocaleString('pl-PL')} PLN</span>
                  <span>{new Date(pos.entryDate).toLocaleDateString('pl-PL')}</span>
                </div>

                {pos.status === 'open' && (
                  <div className="flex gap-2 text-xs">
                    <div className="flex-1 text-center bg-gpw-dark rounded p-1.5">
                      🎯 Cel: <span className="text-gpw-green">+{pos.target}%</span>
                      {cur && <span className="text-gray-400 ml-1">({((pos.entryPrice * (1 + pos.target / 100))).toFixed(2)} PLN)</span>}
                    </div>
                    <div className="flex-1 text-center bg-gpw-dark rounded p-1.5">
                      🛑 Stop: <span className="text-gpw-red">-{pos.stopLoss}%</span>
                      {cur && <span className="text-gray-400 ml-1">({((pos.entryPrice * (1 - pos.stopLoss / 100))).toFixed(2)} PLN)</span>}
                    </div>
                  </div>
                )}

                {pos.status === 'open' && (
                  <button
                    onClick={() => setClosing(pos)}
                    className="w-full border border-gpw-border hover:border-gray-500 text-gray-300 py-2 rounded-lg text-sm transition-colors"
                  >
                    Zamknij pozycję
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-gray-500 text-center">
        ⚠️ Dane edukacyjne. Ceny z ~15 min opóźnieniem. Nie stanowią porady inwestycyjnej.
      </p>
    </div>
  )
}
