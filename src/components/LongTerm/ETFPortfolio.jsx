import { useState, useEffect } from 'react'
import { ETF_CATALOG } from '../../strategies/dca.js'

const today = new Date().toISOString().slice(0, 10)

export default function ETFPortfolio() {
  const [purchases, setPurchases] = useState([])
  const [prices,    setPrices]    = useState({})
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [form,      setForm]      = useState({ ticker: 'vwce', date: today, price: '', units: '' })

  async function load() {
    setLoading(true)
    const data = await fetch('/api/market?mode=etf-list').then(r => r.json()).catch(() => [])
    setPurchases(Array.isArray(data) ? data : [])
    const tickers = [...new Set(data.map(p => p.ticker))]
    tickers.forEach(tkr => {
      fetch(`/api/market?mode=current&ticker=${tkr}&exchange=ETF`)
        .then(r => r.json())
        .then(d => { if (d?.close) setPrices(prev => ({ ...prev, [tkr]: d.close })) })
        .catch(() => {})
    })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addPurchase() {
    if (!form.price || !form.units) return
    setSaving(true)
    await fetch('/api/market?mode=etf-add', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticker: form.ticker, date: form.date, price: Number(form.price), units: Number(form.units) }),
    }).catch(() => {})
    setForm({ ticker: 'vwce', date: today, price: '', units: '' })
    setShowForm(false)
    setSaving(false)
    load()
  }

  async function deletePurchase(id) {
    await fetch('/api/market?mode=etf-delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    }).catch(() => {})
    load()
  }

  // Group purchases by ticker
  const groups = ETF_CATALOG.map(etf => {
    const rows   = purchases.filter(p => p.ticker === etf.ticker)
    if (!rows.length) return null
    const totalUnits  = rows.reduce((s, r) => s + r.units, 0)
    const totalCost   = rows.reduce((s, r) => s + r.price * r.units, 0)
    const avgCost     = totalCost / totalUnits
    const currentPx   = prices[etf.ticker]
    const currentVal  = currentPx ? currentPx * totalUnits : null
    const pnl         = currentVal != null ? currentVal - totalCost : null
    const pnlPct      = pnl != null ? (pnl / totalCost * 100) : null
    return { etf, rows, totalUnits, avgCost, totalCost, currentPx, currentVal, pnl, pnlPct }
  }).filter(Boolean)

  const totalInvested = groups.reduce((s, g) => s + g.totalCost, 0)
  const totalCurrent  = groups.reduce((s, g) => s + (g.currentVal ?? g.totalCost), 0)
  const totalPnl      = totalCurrent - totalInvested

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">📦 Moje ETF-y</h3>
        <button
          onClick={() => setShowForm(s => !s)}
          className="text-xs bg-gpw-blue hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {showForm ? 'Anuluj' : '+ Dodaj zakup'}
        </button>
      </div>

      {showForm && (
        <div className="bg-gpw-dark border border-gpw-border rounded-xl p-4 space-y-3">
          <p className="text-xs text-gray-400 font-semibold">Nowy zakup ETF</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
              <span className="text-xs text-gray-400">ETF</span>
              <select
                value={form.ticker}
                onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
                className="mt-1 w-full bg-gpw-card border border-gpw-border rounded px-3 py-2 text-sm"
              >
                {ETF_CATALOG.map(e => (
                  <option key={e.ticker} value={e.ticker}>{e.name} — {e.fullName}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Data zakupu</span>
              <input type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="mt-1 w-full bg-gpw-card border border-gpw-border rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Liczba jednostek</span>
              <input type="number" min="0.01" step="0.01" placeholder="np. 3.5" value={form.units}
                onChange={e => setForm(f => ({ ...f, units: e.target.value }))}
                className="mt-1 w-full bg-gpw-card border border-gpw-border rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="block col-span-2">
              <span className="text-xs text-gray-400">Cena zakupu (EUR)</span>
              <input type="number" min="0" step="0.01" placeholder="np. 115.40" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="mt-1 w-full bg-gpw-card border border-gpw-border rounded px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button
            onClick={addPurchase}
            disabled={saving || !form.price || !form.units}
            className="w-full bg-gpw-green hover:bg-green-600 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz zakup'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-sm text-center py-4">Ładowanie…</div>
      ) : groups.length === 0 ? (
        <div className="bg-gpw-dark rounded-xl p-4 text-gray-500 text-sm text-center">
          Brak zapisanych zakupów. Dodaj pierwszy zakup ETF.
        </div>
      ) : (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Zainwestowano</div>
              <div className="font-bold text-sm">{totalInvested.toFixed(0)} EUR</div>
            </div>
            <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Wartość bieżąca</div>
              <div className="font-bold text-sm">{totalCurrent.toFixed(0)} EUR</div>
            </div>
            <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">P&L</div>
              <div className={`font-bold text-sm ${totalPnl >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(0)} EUR
              </div>
            </div>
          </div>

          {/* Per-ETF breakdown */}
          {groups.map(({ etf, rows, totalUnits, avgCost, currentPx, currentVal, pnl, pnlPct }) => (
            <div key={etf.ticker} className="bg-gpw-dark border border-gpw-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold">{etf.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{etf.fullName}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">{currentPx ? `${currentPx.toFixed(2)} EUR` : '—'}</div>
                  {pnlPct != null && (
                    <div className={`text-xs font-semibold ${pnl >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(0)} EUR ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                    </div>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-400 flex gap-4">
                <span>Jednostki: <span className="text-white">{totalUnits.toFixed(2)}</span></span>
                <span>Śr. koszt: <span className="text-white">{avgCost.toFixed(2)} EUR</span></span>
                {currentVal != null && <span>Wartość: <span className="text-white">{currentVal.toFixed(0)} EUR</span></span>}
              </div>
              <div className="space-y-1">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-xs text-gray-500">
                    <span>{r.date} · {r.units} szt. · {r.price} EUR</span>
                    <button
                      onClick={() => deletePurchase(r.id)}
                      className="text-gpw-red hover:text-red-400 ml-2"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      <p className="text-xs text-gray-600 text-center">Ceny ETF z giełdy LSE (EUR, ~15 min opóźnienie)</p>
    </div>
  )
}
