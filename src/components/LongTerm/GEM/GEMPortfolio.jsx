import { useEffect, useState } from 'react'

export default function GEMPortfolio({ decision }) {
  const [invested,  setInvested]  = useState('')
  const [units,     setUnits]     = useState('')
  const [price,     setPrice]     = useState(null)
  const [saved,     setSaved]     = useState(null)
  const [saving,    setSaving]    = useState(false)

  const etf = decision?.etf ?? null

  useEffect(() => {
    fetch('/api/market?mode=gem-portfolio')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setSaved(data)
          setInvested(data.investedAmount ?? '')
          setUnits(data.units ?? '')
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!etf) return
    const sym = etf === 'CSPX' ? 'CSPX.L' : etf === 'SWRD' ? 'SWRD.L' : 'AGGH.L'
    fetch(`/api/market?mode=current&ticker=${encodeURIComponent(sym)}&exchange=ETF`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.price) setPrice(d.price) })
      .catch(() => {})
  }, [etf])

  const currentValue = price && units ? (parseFloat(units) * price).toFixed(2) : null
  const gain = currentValue && invested
    ? (parseFloat(currentValue) - parseFloat(invested)).toFixed(2)
    : null
  const gainPct = gain && invested
    ? ((parseFloat(gain) / parseFloat(invested)) * 100).toFixed(1)
    : null

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/market?mode=gem-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investedAmount: parseFloat(invested) || 0,
          units:          parseFloat(units)    || 0,
          etf,
          updatedAt: new Date().toISOString(),
        }),
      })
      setSaved({ investedAmount: parseFloat(invested), units: parseFloat(units), etf })
    } catch {}
    setSaving(false)
  }

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-4">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Mój portfel GEM</div>

      {currentValue && (
        <div className="flex flex-wrap gap-4">
          <div>
            <div className="text-xs text-gray-500">Obecna wartość</div>
            <div className="text-xl font-bold text-white">{parseFloat(currentValue).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} GBP</div>
          </div>
          {gain != null && (
            <div>
              <div className="text-xs text-gray-500">P&L</div>
              <div className={`text-xl font-bold ${parseFloat(gain) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {parseFloat(gain) >= 0 ? '+' : ''}{parseFloat(gain).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN
                <span className="text-sm ml-1">({gainPct >= 0 ? '+' : ''}{gainPct}%)</span>
              </div>
            </div>
          )}
          {price && etf && (
            <div>
              <div className="text-xs text-gray-500">Cena {etf}</div>
              <div className="text-sm text-gray-300 font-medium">{price.toFixed(2)} GBP</div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Zainwestowano (PLN)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={invested}
              onChange={e => setInvested(e.target.value)}
              placeholder="np. 5000"
              className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gpw-blue"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Liczba jednostek {etf ?? ''}</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={units}
              onChange={e => setUnits(e.target.value)}
              placeholder="np. 12.5"
              className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gpw-blue"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="text-xs bg-gpw-blue hover:bg-blue-500 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          {saving ? 'Zapisuję…' : '💾 Zapisz pozycję'}
        </button>
      </form>

      {saved && (
        <p className="text-xs text-gray-500">
          Ostatnio zapisano: {parseFloat(saved.investedAmount ?? 0).toLocaleString('pl-PL')} PLN · {saved.units ?? 0} szt. {saved.etf ?? ''}
        </p>
      )}

      {gain != null && parseFloat(gain) > 0 && (
        <div className="text-xs text-yellow-400 border border-yellow-900 rounded p-2">
          ⚠️ Szacowany podatek Belki od zysku: ~{Math.round(parseFloat(gain) * 0.19).toLocaleString('pl-PL')} PLN (19%)
        </div>
      )}
    </div>
  )
}
