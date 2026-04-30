import { useState, useEffect } from 'react'
import { SCALPING_DEFAULTS } from '../../strategies/scalping.js'
import { SWING_DEFAULTS } from '../../strategies/swing.js'
import { AGGRESSIVE_DEFAULTS } from '../../strategies/aggressive.js'

const STRATEGY_META = {
  scalping:   { label: '⚡ Scalping',  color: 'text-yellow-400', defaults: SCALPING_DEFAULTS,   target: '3-7%',   time: '2-5 dni' },
  swing:      { label: '📈 Swing',     color: 'text-blue-400',   defaults: SWING_DEFAULTS,      target: '10-20%', time: '4-8 tyg.' },
  aggressive: { label: '🚀 Agresywna', color: 'text-red-400',    defaults: AGGRESSIVE_DEFAULTS, target: '20-50%', time: 'N/A' },
}

function RecommendationPanel({ strategy }) {
  const [recs, setRecs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [amounts, setAmounts] = useState({})
  const [done, setDone]       = useState({})

  const portfolio = (() => {
    try { return JSON.parse(localStorage.getItem('gpw_settings') ?? '{}').capital ?? 10000 }
    catch { return 10000 }
  })()

  const maxPct = (() => {
    try { return JSON.parse(localStorage.getItem('gpw_settings') ?? '{}').maxPositionPct ?? 15 }
    catch { return 15 }
  })()

  useEffect(() => {
    setLoading(true)
    setRecs([])
    setDone({})
    fetch(`/api/recommendations?strategy=${strategy}`)
      .then(r => r.json())
      .then(data => {
        setRecs(data)
        const init = {}
        data.forEach(r => { init[r.ticker] = Math.round(portfolio * maxPct / 100) })
        setAmounts(init)
      })
      .catch(() => setRecs([]))
      .finally(() => setLoading(false))
  }, [strategy])

  async function confirm(rec) {
    const positionSize = amounts[rec.ticker]
    await fetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker:       rec.ticker,
        strategy:     rec.strategy,
        entryPrice:   rec.price,
        positionSize,
        target:       rec.target,
        stopLoss:     rec.stopLoss,
        signal:       rec.signal,
      }),
    })
    setDone(d => ({ ...d, [rec.ticker]: 'confirmed' }))
  }

  function skip(ticker) {
    setDone(d => ({ ...d, [ticker]: 'skipped' }))
  }

  if (loading) {
    return <div className="text-gray-400 text-sm py-4 text-center">Szukam sygnałów… (może potrwać 30s)</div>
  }

  const visible = recs.filter(r => !done[r.ticker])

  if (visible.length === 0 && recs.length === 0) {
    return (
      <div className="bg-gpw-dark rounded-lg p-4 text-sm text-gray-400 text-center">
        Brak sygnałów dla tej strategii. Sprawdź ponownie jutro rano.
      </div>
    )
  }

  if (visible.length === 0) {
    return (
      <div className="bg-gpw-dark rounded-lg p-4 text-sm text-center">
        {Object.values(done).filter(v => v === 'confirmed').length > 0
          ? <span className="text-gpw-green">✅ Pozycje zapisane w Moich wynikach.</span>
          : <span className="text-gray-400">Wszystkie rekomendacje przetworzone.</span>
        }
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {visible.map(rec => {
        const amt   = amounts[rec.ticker] ?? Math.round(portfolio * maxPct / 100)
        const shares = Math.floor(amt / rec.price)
        return (
          <div key={rec.ticker} className="bg-gpw-dark border border-gpw-border rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-bold text-lg">{rec.tickerDisplay}</span>
                <span className="ml-2 text-xs text-gray-400">{rec.signal}</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{rec.price} PLN</div>
                <div className="text-xs text-gray-400">{new Date(rec.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-center">
              {rec.rsi && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">RSI</div><div className="font-bold">{rec.rsi}</div></div>}
              {rec.volMult && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">Wolumen</div><div className="font-bold">{rec.volMult}x</div></div>}
              <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">Cel</div><div className="font-bold text-gpw-green">+{rec.target}%</div></div>
              <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">Stop loss</div><div className="font-bold text-gpw-red">-{rec.stopLoss}%</div></div>
              {rec.sma20 && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">SMA20</div><div className="font-bold">{rec.sma20?.toFixed(2)}</div></div>}
              {rec.sma50 && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">SMA50</div><div className="font-bold">{rec.sma50?.toFixed(2)}</div></div>}
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Kwota pozycji</span>
                <span className="text-white font-semibold">{amt.toLocaleString('pl-PL')} PLN ≈ {shares} akcji</span>
              </div>
              <input
                type="range"
                min={Math.round(portfolio * 0.05)}
                max={Math.round(portfolio * maxPct / 100)}
                step={100}
                value={amt}
                onChange={e => setAmounts(a => ({ ...a, [rec.ticker]: Number(e.target.value) }))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>5%</span><span>{maxPct}%</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => confirm(rec)}
                className="flex-1 bg-gpw-green hover:bg-green-600 text-white py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                ✅ Realizuję
              </button>
              <button
                onClick={() => skip(rec.ticker)}
                className="flex-1 bg-gpw-card hover:bg-gpw-border text-gray-300 py-2 rounded-lg text-sm transition-colors"
              >
                Pomijam
              </button>
            </div>

            <p className="text-xs text-gray-500 text-center">
              ⚠️ Analiza edukacyjna. Ceny z ~15 min opóźnieniem.
            </p>
          </div>
        )
      })}
    </div>
  )
}

export default function Strategies() {
  const [active, setActive] = useState(
    () => localStorage.getItem('gpw_strategy') ?? 'swing'
  )
  const [showRecs, setShowRecs] = useState(false)

  useEffect(() => {
    localStorage.setItem('gpw_strategy', active)
    setShowRecs(false)
  }, [active])

  return (
    <div className="space-y-4">
      {Object.entries(STRATEGY_META).map(([key, meta]) => (
        <div
          key={key}
          className={`bg-gpw-card border rounded-lg p-5 cursor-pointer transition-all ${
            active === key ? 'border-gpw-blue' : 'border-gpw-border hover:border-gray-500'
          }`}
          onClick={() => setActive(key)}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`font-semibold text-lg ${meta.color}`}>{meta.label}</span>
            {active === key && <span className="text-xs bg-gpw-blue text-white px-2 py-0.5 rounded">AKTYWNA</span>}
          </div>
          <div className="text-sm text-gray-400 grid grid-cols-2 gap-2">
            <div>Cel: <span className="text-white">{meta.target}</span></div>
            <div>Horyzont: <span className="text-white">{meta.time}</span></div>
            <div>Stop loss: <span className="text-gpw-red">-{meta.defaults.stopLossPct}%</span></div>
            <div>Max alertów: <span className="text-white">{meta.defaults.maxAlertsPerDay}/dzień</span></div>
          </div>
        </div>
      ))}

      <div className="bg-gpw-card border border-gpw-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Rekomendacje — {STRATEGY_META[active]?.label}</h2>
          <button
            onClick={() => setShowRecs(s => !s)}
            className="text-sm bg-gpw-blue hover:bg-blue-600 text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {showRecs ? 'Ukryj' : 'Sprawdź sygnały'}
          </button>
        </div>

        {showRecs && <RecommendationPanel key={active} strategy={active} />}

        {!showRecs && (
          <p className="text-sm text-gray-400">
            Kliknij „Sprawdź sygnały" aby przeskanować spółki z universum strategii {STRATEGY_META[active]?.label}.
          </p>
        )}
      </div>
    </div>
  )
}
