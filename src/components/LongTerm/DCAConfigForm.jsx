import { useState, useEffect } from 'react'
import { ETF_CATALOG, calculateDCAProjection } from '../../strategies/dca.js'

const DEFAULT_CONFIG = {
  etfs:        [{ ticker: 'vwce', pct: 70 }, { ticker: 'cspx', pct: 30 }],
  monthlyPLN:  500,
  dayOfMonth:  1,
}

function pctTotal(etfs) {
  return etfs.reduce((s, e) => s + (Number(e.pct) || 0), 0)
}

export default function DCAConfigForm() {
  const [config,   setConfig]   = useState(DEFAULT_CONFIG)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [projYrs,  setProjYrs]  = useState(20)
  const [projRate, setProjRate] = useState(8)

  useEffect(() => {
    fetch('/api/kv?key=dca:config')
      .then(r => r.json())
      .then(({ value }) => { if (value?.etfs) setConfig(value) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggleEtf(ticker) {
    setConfig(prev => {
      const exists = prev.etfs.find(e => e.ticker === ticker)
      if (exists) {
        if (prev.etfs.length === 1) return prev
        return { ...prev, etfs: prev.etfs.filter(e => e.ticker !== ticker) }
      }
      return { ...prev, etfs: [...prev.etfs, { ticker, pct: 0 }] }
    })
  }

  function setPct(ticker, val) {
    setConfig(prev => ({
      ...prev,
      etfs: prev.etfs.map(e => e.ticker === ticker ? { ...e, pct: Number(val) } : e),
    }))
  }

  async function save() {
    setSaving(true)
    await fetch('/api/kv', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: 'dca:config', value: config }),
    }).catch(() => {})
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const total   = pctTotal(config.etfs)
  const projPLN = calculateDCAProjection(config.monthlyPLN, projYrs, projRate)

  if (loading) return <p className="text-gray-400 text-sm">Ładowanie konfiguracji…</p>

  return (
    <div className="space-y-6">

      {/* ETF selection */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Wybierz ETF</h3>
        <div className="space-y-2">
          {ETF_CATALOG.map(etf => {
            const selected = config.etfs.find(e => e.ticker === etf.ticker)
            return (
              <div key={etf.ticker} className={`bg-gpw-dark border rounded-lg p-3 ${selected ? 'border-gpw-blue' : 'border-gpw-border'}`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={!!selected}
                    onChange={() => toggleEtf(etf.ticker)}
                    className="accent-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{etf.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${etf.type === 'acc' ? 'bg-blue-900 text-blue-300' : 'bg-green-900 text-green-300'}`}>
                        {etf.type === 'acc' ? 'Akum.' : 'Dyst.'}
                      </span>
                      <span className="text-xs text-gray-500">TER {etf.ter}%</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{etf.fullName} — {etf.description}</p>
                    <p className="text-xs text-gray-600">ISIN: {etf.isin}</p>
                  </div>
                  {selected && (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={selected.pct}
                        onChange={e => setPct(etf.ticker, e.target.value)}
                        className="w-14 bg-gpw-card border border-gpw-border rounded px-2 py-1 text-sm text-right"
                      />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className={`text-xs mt-1 ${total === 100 ? 'text-green-400' : 'text-yellow-400'}`}>
          Suma: {total}% {total !== 100 && '← musi wynosić 100%'}
        </p>
      </div>

      {/* Amount & day */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-gray-300 block mb-1">Kwota miesięczna (PLN)</label>
          <input
            type="number"
            min="50"
            step="50"
            value={config.monthlyPLN}
            onChange={e => setConfig(p => ({ ...p, monthlyPLN: Number(e.target.value) }))}
            className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-300 block mb-1">Dzień miesiąca</label>
          <input
            type="number"
            min="1"
            max="28"
            value={config.dayOfMonth}
            onChange={e => setConfig(p => ({ ...p, dayOfMonth: Number(e.target.value) }))}
            className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving || total !== 100}
        className="w-full bg-gpw-blue hover:bg-blue-600 disabled:opacity-50 text-white font-semibold py-2 rounded transition-colors"
      >
        {saving ? 'Zapisuję…' : saved ? '✅ Zapisano!' : 'Zapisz konfigurację DCA'}
      </button>

      {/* DCA Projection calculator */}
      <div className="border-t border-gpw-border pt-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">🧮 Kalkulator DCA</h3>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Lata inwestowania</label>
            <input
              type="number"
              min="1"
              max="40"
              value={projYrs}
              onChange={e => setProjYrs(Number(e.target.value))}
              className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Zakładany zwrot rocznie (%)</label>
            <input
              type="number"
              min="1"
              max="20"
              step="0.5"
              value={projRate}
              onChange={e => setProjRate(Number(e.target.value))}
              className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="bg-gpw-dark rounded-lg p-4 text-center">
          <p className="text-xs text-gray-400 mb-1">
            {config.monthlyPLN} PLN/mies. przez {projYrs} lat przy {projRate}% rocznie
          </p>
          <p className="text-2xl font-bold text-green-400">{projPLN.toLocaleString('pl-PL')} PLN</p>
          <p className="text-xs text-gray-500 mt-1">
            Wpłacono: {(config.monthlyPLN * projYrs * 12).toLocaleString('pl-PL')} PLN
            {' · '}
            Zysk z reinwestycji: {(projPLN - config.monthlyPLN * projYrs * 12).toLocaleString('pl-PL')} PLN
          </p>
        </div>
        <p className="text-xs text-gray-600 mt-2">* Kalkulator zakłada stały zwrot. Rzeczywiste wyniki mogą się różnić.</p>
      </div>

    </div>
  )
}
