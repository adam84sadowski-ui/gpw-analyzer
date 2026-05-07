import { useState, useEffect, useRef } from 'react'
import { SCALPING_DEFAULTS } from '../../strategies/scalping.js'
import { SWING_DEFAULTS } from '../../strategies/swing.js'
import { AGGRESSIVE_DEFAULTS } from '../../strategies/aggressive.js'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { interpretSignal } from '../../lib/interpretSignal.js'

const STRATEGY_META = {
  scalping:   { label: '⚡ Scalping',  color: 'text-yellow-400', defaults: SCALPING_DEFAULTS,   target: '3-7%',   time: '2-5 dni' },
  swing:      { label: '📈 Swing',     color: 'text-blue-400',   defaults: SWING_DEFAULTS,      target: '10-20%', time: '4-8 tyg.' },
  aggressive: { label: '🚀 Agresywna', color: 'text-red-400',    defaults: AGGRESSIVE_DEFAULTS, target: '20-50%', time: 'N/A' },
}

function RecommendationPanel({ strategy, exchange }) {
  const [viewMode, setViewMode]       = useState('signals')
  const [recs, setRecs]               = useState([])
  const [scanData, setScanData]       = useState([])
  const [sigsLoading, setSigsLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [amounts, setAmounts]         = useState({})
  const [done, setDone]               = useState({})
  const [eodhd, setEodhd]             = useState({})
  const [interpretOpen, setInterpretOpen] = useState({})
  const scanStartedRef                = useRef(false)

  const portfolio = (() => {
    try { return JSON.parse(localStorage.getItem('gpw_settings') ?? '{}').capital ?? 10000 }
    catch { return 10000 }
  })()
  const maxPct = (() => {
    try { return JSON.parse(localStorage.getItem('gpw_settings') ?? '{}').maxPositionPct ?? 15 }
    catch { return 15 }
  })()

  function startScanFetch() {
    if (scanStartedRef.current) return
    scanStartedRef.current = true
    setScanLoading(true)
    fetch(`/api/market?mode=scan&strategy=${strategy}&exchange=${exchange}`)
      .then(r => r.json())
      .then(data => setScanData(Array.isArray(data) ? data : []))
      .catch(() => setScanData([]))
      .finally(() => setScanLoading(false))
  }

  // Load signals; after completion kick off scan in background for Top RSI
  useEffect(() => {
    setSigsLoading(true)
    setRecs([])
    setDone({})
    scanStartedRef.current = false
    setScanData([])
    fetch(`/api/market?mode=signals&strategy=${strategy}&exchange=${exchange}`)
      .then(r => r.json())
      .then(data => {
        setRecs(data)
        const init = {}
        data.forEach(r => { init[r.ticker] = Math.round(portfolio * maxPct / 100) })
        setAmounts(init)
        if (exchange === 'GPW') {
          data.forEach(r => {
            fetch(`/api/eodhd?ticker=${r.ticker}`)
              .then(res => res.json())
              .then(d => setEodhd(prev => ({ ...prev, [r.ticker]: d })))
              .catch(() => {})
          })
        }
      })
      .catch(() => setRecs([]))
      .finally(() => {
        setSigsLoading(false)
        startScanFetch() // background load for Top RSI
      })
  }, [strategy, exchange])

  // When switching to scan tab, ensure scan data is loaded
  useEffect(() => {
    if (viewMode === 'scan') startScanFetch()
  }, [viewMode])

  const topRsi = [...scanData]
    .filter(r => r.rsi !== null)
    .sort((a, b) => a.rsi - b.rsi)
    .slice(0, 5)

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

  return (
    <div className="space-y-3">

      {/* Top 5 RSI Oversold — zawsze widoczne */}
      <div className="bg-gpw-dark rounded-lg p-3 space-y-2">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">📊 Top 5 — RSI Wyprzedane</div>
        {scanLoading ? (
          <div className="text-xs text-gray-500 animate-pulse">Ładowanie wskaźników…</div>
        ) : topRsi.length === 0 ? (
          <div className="text-xs text-gray-500">Brak danych (załaduje się po zakończeniu skanowania)</div>
        ) : (
          <div className="space-y-1.5">
            {topRsi.map(r => {
              const rsiVal = r.rsi?.toFixed(1)
              const badge  = r.rsi < 30 ? 'bg-gpw-green text-white'
                : r.rsi < 40 ? 'bg-yellow-600 text-white'
                : 'bg-gpw-card text-gray-400'
              const cur = r.exchange === 'NYSE' ? 'USD' : 'PLN'
              return (
                <div key={r.ticker} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold w-12">{r.tickerDisplay}</span>
                    {r.companyName && <span className="text-gray-500 truncate max-w-[90px]">({r.companyName})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded font-bold text-xs ${badge}`}>RSI {rsiVal}</span>
                    <span className="text-gray-400 w-20 text-right">{r.price} {cur}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="flex border border-gpw-border rounded-lg overflow-hidden text-sm">
        <button
          onClick={() => setViewMode('signals')}
          className={`flex-1 py-2 transition-colors ${viewMode === 'signals' ? 'bg-gpw-blue text-white' : 'bg-gpw-dark text-gray-400 hover:text-white'}`}
        >
          Tylko sygnały
        </button>
        <button
          onClick={() => setViewMode('scan')}
          className={`flex-1 py-2 transition-colors ${viewMode === 'scan' ? 'bg-gpw-blue text-white' : 'bg-gpw-dark text-gray-400 hover:text-white'}`}
        >
          Wszystkie spółki
        </button>
      </div>

      {/* Signals view */}
      {viewMode === 'signals' && (
        sigsLoading ? (
          <div className="text-gray-400 text-sm py-4 text-center">Szukam sygnałów… (może potrwać 30s)</div>
        ) : (() => {
          const visible = recs.filter(r => !done[r.ticker])
          if (visible.length === 0 && recs.length === 0) {
            return (
              <div className="bg-gpw-dark rounded-lg p-4 text-sm text-gray-400 text-center">
                Brak sygnałów dla tej strategii. Sprawdź widok &bdquo;Wszystkie spółki&rdquo; lub Top RSI powyżej.
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
          return visible.map(rec => {
            const amt       = amounts[rec.ticker] ?? Math.round(portfolio * maxPct / 100)
            const shares    = Math.floor(amt / rec.price)
            const targetPLN = (rec.price * (1 + rec.target / 100)).toFixed(2)
            const stopPLN   = (rec.price * (1 - rec.stopLoss / 100)).toFixed(2)
            const horizon   = STRATEGY_META[rec.strategy ?? strategy]?.time
            const currency  = rec.exchange === 'NYSE' ? 'USD' : 'PLN'
            return (
              <div key={rec.ticker} className="bg-gpw-dark border border-gpw-border rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-bold text-lg">{rec.tickerDisplay}</span>
                    {rec.companyName && <span className="ml-1.5 text-xs text-gray-500">({rec.companyName})</span>}
                    <span className="ml-2 text-xs text-gray-400">{rec.signal}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{rec.price} {currency}</div>
                    <div className="text-xs text-gray-400">{new Date(rec.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  {rec.rsi && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">RSI</div><div className="font-bold">{rec.rsi}</div></div>}
                  {rec.volMult && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">Wolumen</div><div className="font-bold">{rec.volMult}x</div></div>}
                  {horizon && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">Horyzont</div><div className="font-bold">⏱ {horizon}</div></div>}
                  <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">🎯 Cel</div><div className="font-bold text-gpw-green">+{rec.target}% <span className="text-gray-400 font-normal">({targetPLN})</span></div></div>
                  <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">🛑 Stop</div><div className="font-bold text-gpw-red">-{rec.stopLoss}% <span className="text-gray-400 font-normal">({stopPLN})</span></div></div>
                  {rec.sma20 && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">SMA20</div><div className="font-bold">{rec.sma20?.toFixed(2)}</div></div>}
                  {rec.sma50 && <div className="bg-gpw-card rounded p-1.5"><div className="text-gray-400">SMA50</div><div className="font-bold">{rec.sma50?.toFixed(2)}</div></div>}
                  {eodhd[rec.ticker]?.pe && (
                    <div className="bg-gpw-card rounded p-1.5 text-xs text-center">
                      <div className="text-gray-400">P/E</div>
                      <div className="font-bold">{eodhd[rec.ticker].pe}</div>
                    </div>
                  )}
                  {eodhd[rec.ticker]?.dividendYield && (
                    <div className="bg-gpw-card rounded p-1.5 text-xs text-center">
                      <div className="text-gray-400">Dywidenda</div>
                      <div className="font-bold text-gpw-green">{eodhd[rec.ticker].dividendYield}%</div>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Kwota pozycji</span>
                    <span className="text-white font-semibold">{amt.toLocaleString('pl-PL')} {currency} ≈ {shares} akcji</span>
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

                {/* Interpretacja sygnału */}
                <div className="border-t border-gpw-border pt-2">
                  <button
                    onClick={() => setInterpretOpen(s => ({ ...s, [rec.ticker]: !s[rec.ticker] }))}
                    className="w-full text-left text-xs text-gray-400 hover:text-white flex items-center justify-between py-1 transition-colors"
                  >
                    <span>📖 Co robić z tym sygnałem?</span>
                    <span>{interpretOpen[rec.ticker] ? '▲' : '▼'}</span>
                  </button>
                  {interpretOpen[rec.ticker] && (() => {
                    const interp = interpretSignal(
                      rec.signal,
                      { rsi: rec.rsi, volMult: rec.volMult, price: rec.price, sma20: rec.sma20, sma50: rec.sma50 },
                      rec.strategy ?? strategy,
                    )
                    return (
                      <div className="mt-2 space-y-2 text-xs bg-gpw-card rounded-lg p-3">
                        <p className="text-gray-300 leading-relaxed">{interp.text}</p>
                        {interp.positives.map((p, i) => <p key={i} className="text-gpw-green">{p}</p>)}
                        {interp.warnings.map((w, i)  => <p key={i} className="text-yellow-400">{w}</p>)}
                        <p className="text-gray-500 pt-1">⏱ Sugerowany horyzont: <span className="text-white">{interp.horizon.label}</span></p>
                      </div>
                    )
                  })()}
                </div>

                <p className="text-xs text-gray-500 text-center">
                  ⚠️ Analiza edukacyjna. Ceny z ~15 min opóźnieniem.
                </p>
              </div>
            )
          })
        })()
      )}

      {/* Scan view — all stocks with indicators */}
      {viewMode === 'scan' && (
        scanLoading ? (
          <div className="text-gray-400 text-sm py-4 text-center">Skanem spółki… (może potrwać 30s)</div>
        ) : scanData.length === 0 ? (
          <div className="bg-gpw-dark rounded-lg p-4 text-sm text-gray-400 text-center">
            Brak danych. Sprawdź ponownie za chwilę.
          </div>
        ) : (
          <div className="space-y-2">
            {scanData.map(row => {
              const rsiColor = row.rsi === null ? 'text-gray-400'
                : row.rsi < 30 ? 'text-gpw-green font-bold'
                : row.rsi > 70 ? 'text-gpw-red font-bold'
                : 'text-white'
              const volColor = row.volMult && row.volMult >= 2 ? 'text-yellow-400 font-bold' : 'text-white'
              return (
                <div
                  key={row.ticker}
                  className={`bg-gpw-dark border rounded-lg p-3 ${row.hasSignal ? 'border-gpw-green' : 'border-gpw-border'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{row.tickerDisplay}</span>
                      {row.companyName && <span className="text-xs text-gray-500">({row.companyName})</span>}
                      {row.hasSignal
                        ? <span className="text-xs bg-gpw-green text-white px-1.5 py-0.5 rounded">⚡ {row.signal}</span>
                        : <span className="text-xs text-gray-500">brak sygnału</span>
                      }
                    </div>
                    <span className="font-semibold text-sm">{row.price} {row.exchange === 'NYSE' ? 'USD' : 'PLN'}</span>
                  </div>
                  <div className="flex gap-3 mt-2 text-xs">
                    <span className="text-gray-400">RSI: <span className={rsiColor}>{row.rsi ?? '—'}</span></span>
                    <span className="text-gray-400">Vol: <span className={volColor}>{row.volMult ? `${row.volMult}x` : '—'}</span></span>
                    {row.sma50 && <span className="text-gray-400">SMA50: <span className="text-white">{row.sma50.toFixed(2)}</span></span>}
                    {row.sma20 && <span className="text-gray-400">SMA20: <span className="text-white">{row.sma20.toFixed(2)}</span></span>}
                  </div>
                </div>
              )
            })}
            <p className="text-xs text-gray-500 text-center pt-1">
              ⚠️ Dane edukacyjne z ~15 min opóźnieniem.
            </p>
          </div>
        )
      )}
    </div>
  )
}

const IS_STAGING = window.location.hostname !== 'gpw-analyzer.vercel.app'

export default function Strategies() {
  const { exchange } = useExchange()
  const [active, setActive] = useState(
    () => localStorage.getItem('gpw_strategy') ?? 'swing'
  )
  const [showRecs, setShowRecs]     = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  async function triggerCron(force) {
    setTriggering(true)
    setTriggerMsg('')
    try {
      const r = await fetch('/api/cron/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: active, force, exchange }),
      })
      const d = await r.json()
      setTriggerMsg(d.sent > 0 ? `✅ Alert wysłany (${d.ticker ?? 'TEST'})` : d.message)
    } catch {
      setTriggerMsg('❌ Błąd połączenia')
    } finally {
      setTriggering(false)
    }
  }

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

        {showRecs && <RecommendationPanel key={`${active}-${exchange}`} strategy={active} exchange={exchange} />}

        {!showRecs && (
          <p className="text-sm text-gray-400">
            Kliknij &bdquo;Sprawdź sygnały&rdquo; aby przeskanować spółki i zobaczyć Top RSI oraz sygnały dla strategii {STRATEGY_META[active]?.label}.
          </p>
        )}

        {IS_STAGING && (
          <div className="mt-4 pt-4 border-t border-gpw-border space-y-2">
            <p className="text-xs text-gray-500">🧪 Tryb testowy (staging)</p>
            <div className="flex gap-2">
              <button
                onClick={() => triggerCron(false)}
                disabled={triggering}
                className="flex-1 text-xs border border-gpw-border hover:border-gray-400 text-gray-300 py-1.5 rounded transition-colors disabled:opacity-50"
              >
                {triggering ? '…' : 'Wyślij real alert'}
              </button>
              <button
                onClick={() => triggerCron(true)}
                disabled={triggering}
                className="flex-1 text-xs border border-yellow-700 hover:border-yellow-500 text-yellow-400 py-1.5 rounded transition-colors disabled:opacity-50"
              >
                {triggering ? '…' : 'Wyślij TEST alert'}
              </button>
            </div>
            {triggerMsg && <p className="text-xs text-center text-gray-400">{triggerMsg}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
