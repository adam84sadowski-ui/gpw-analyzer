import { useState, useEffect, useMemo } from 'react'
import { fetchIndex, fetchDaily } from '../../services/stooq.js'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { allTickers } from '../../lib/universes.js'
import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

const EXCHANGE_CONFIG = {
  GPW: {
    indices:     ['wig20.pl', 'mwig40.pl', 'swig80.pl'],
    indexLabels: { 'wig20.pl': 'WIG20', 'mwig40.pl': 'mWIG40', 'swig80.pl': 'sWIG80' },
    defaults:    ['pkn.pl', 'kghm.pl', 'cdr.pl'],
  },
  NYSE: {
    indices:     ['^gspc', '^ixic', '^dji'],
    indexLabels: { '^gspc': 'S&P 500', '^ixic': 'NASDAQ', '^dji': 'Dow Jones' },
    defaults:    ['AAPL', 'MSFT', 'NVDA'],
  },
}

const LINE_COLORS = ['#58a6ff', '#3fb950', '#f97316']

function tickerLabel(t) {
  return t.replace(/\.pl$/i, '').toUpperCase()
}

export default function Dashboard() {
  const { exchange, currency } = useExchange()
  const config = EXCHANGE_CONFIG[exchange]

  const [indexData,       setIndexData]       = useState({})
  const [indexPerfData,   setIndexPerfData]   = useState({})
  const [tickerCandles,   setTickerCandles]   = useState({})
  const [selectedTickers, setSelectedTickers] = useState([])
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [pickerOpen,      setPickerOpen]      = useState(false)
  const [recentAlerts,    setRecentAlerts]    = useState([])
  const [macro,           setMacro]           = useState(null)

  // On exchange change: load initial tickers from positions, fall back to defaults
  useEffect(() => {
    setSelectedTickers([])
    setTickerCandles({})
    setSearch('')
    const saved = localStorage.getItem(`gpw_chart_tickers_${exchange}`)
    if (saved) {
      try {
        setSelectedTickers(JSON.parse(saved))
        return
      } catch {}
    }
    fetch('/api/positions?status=open')
      .then(r => r.json())
      .then(data => {
        const posTickers = [...new Set(data.map(p => p.ticker))]
          .filter(t => exchange === 'NYSE' ? !t.includes('.') : t.includes('.pl'))
          .slice(0, 3)
        setSelectedTickers(posTickers.length > 0 ? posTickers : config.defaults)
      })
      .catch(() => setSelectedTickers(config.defaults))
  }, [exchange])

  // Fetch candles for any newly selected ticker
  useEffect(() => {
    if (selectedTickers.length === 0) return
    const missing = selectedTickers.filter(t => !tickerCandles[t])
    if (missing.length === 0) return
    setLoading(true)
    Promise.all(missing.map(t =>
      fetchDaily(t, exchange)
        .then(candles => ({ t, candles }))
        .catch(() => ({ t, candles: [] }))
    )).then(results => {
      setTickerCandles(prev => {
        const next = { ...prev }
        results.forEach(({ t, candles }) => { next[t] = candles })
        return next
      })
    }).finally(() => setLoading(false))
  }, [selectedTickers, exchange])

  // Load index cards (current price)
  useEffect(() => {
    setIndexData({})
    Promise.all(config.indices.map(i =>
      fetchIndex(i, exchange).then(d => ({ ticker: i, data: d })).catch(() => ({ ticker: i, data: null }))
    )).then(results => {
      const m = {}
      results.forEach(({ ticker, data }) => { m[ticker] = data })
      setIndexData(m)
    })
  }, [exchange])

  // Load index historical % changes (1M / 3M / YTD), cached in localStorage per exchange+day
  useEffect(() => {
    setIndexPerfData({})
    const today    = new Date().toISOString().slice(0, 10)
    const cacheKey = `gpw_idx_perf_${exchange}_${today}`
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) { setIndexPerfData(JSON.parse(cached)); return }
    } catch {}

    Promise.all(config.indices.map(async idx => {
      try {
        const candles = await fetchDaily(idx, exchange)
        if (!candles?.length) return { idx, data: null }
        const last     = candles[candles.length - 1].close
        const yearStr  = `${new Date().getFullYear()}-01-01`
        const findBefore = (daysAgo) => {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - daysAgo)
          const cutoffStr = cutoff.toISOString().slice(0, 10)
          let nearest = null
          for (const c of candles) {
            if (c.date <= cutoffStr) nearest = c
            else break
          }
          return nearest?.close ?? null
        }
        const p1m  = findBefore(30)
        const p3m  = findBefore(90)
        const pYtd = candles.find(c => c.date >= yearStr)?.close ?? null
        const calc = base => base ? +((last - base) / base * 100).toFixed(2) : null
        return { idx, data: { change1M: calc(p1m), change3M: calc(p3m), changeYtd: calc(pYtd) } }
      } catch {
        return { idx, data: null }
      }
    })).then(results => {
      const m = {}
      results.forEach(({ idx, data }) => { m[idx] = data })
      setIndexPerfData(m)
      try { localStorage.setItem(cacheKey, JSON.stringify(m)) } catch {}
    })
  }, [exchange])

  // Load recent alerts
  useEffect(() => {
    fetch('/api/alerts?limit=3')
      .then(r => r.json())
      .then(data => setRecentAlerts(Array.isArray(data) ? data : []))
      .catch(() => setRecentAlerts([]))
  }, [exchange])

  // Load macro environment
  useEffect(() => {
    setMacro(null)
    fetch(`/api/market?mode=macro&exchange=${exchange}`)
      .then(r => r.json())
      .then(data => setMacro(data?.status ? data : null))
      .catch(() => setMacro(null))
  }, [exchange])

  // Compute normalized % change chart data (all tickers on same Y axis)
  const chartData = useMemo(() => {
    const ready = selectedTickers.filter(t => tickerCandles[t]?.length > 0)
    if (ready.length === 0) return []
    const primary = tickerCandles[ready[0]].slice(-60)
    if (primary.length === 0) return []
    const baseDate = primary[0].date
    return primary.map(c => {
      const point = { date: c.date }
      ready.forEach(t => {
        const candles = tickerCandles[t]
        const base    = candles.find(x => x.date === baseDate)?.close
        const cur     = candles.find(x => x.date === c.date)?.close
        if (base && cur) point[tickerLabel(t)] = +((cur - base) / base * 100).toFixed(2)
      })
      return point
    })
  }, [selectedTickers, tickerCandles])

  function toggleTicker(t) {
    setSelectedTickers(prev => {
      let next
      if (prev.includes(t)) {
        next = prev.filter(x => x !== t)
      } else {
        if (prev.length >= 3) return prev
        next = [...prev, t]
      }
      localStorage.setItem(`gpw_chart_tickers_${exchange}`, JSON.stringify(next))
      return next
    })
  }

  const filtered = allTickers(exchange).filter(t =>
    tickerLabel(t).includes(search.toUpperCase()) || search === ''
  )

  return (
    <div className="space-y-6">

      {/* Index cards */}
      <div className="grid grid-cols-3 gap-3">
        {config.indices.map(idx => {
          const d      = indexData[idx]
          const perf   = indexPerfData[idx]
          const close  = d ? (d.close ?? parseFloat(d.Close)) : null
          const open   = d ? (d.open  ?? parseFloat(d.Open))  : null
          const change = close && open && !isNaN(open) ? ((close - open) / open * 100).toFixed(2) : null
          const fmtPct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v}%`
          const pctCls = v => v == null ? 'text-gray-500' : v >= 0 ? 'text-gpw-green' : 'text-gpw-red'
          return (
            <div key={idx} className="bg-gpw-card border border-gpw-border rounded-lg p-3">
              <div className="text-xs text-gray-400">{config.indexLabels[idx]}</div>
              <div className="text-lg font-bold leading-tight">{close?.toLocaleString() ?? '—'}</div>
              {change !== null && (
                <div className={`text-sm ${parseFloat(change) >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                  {parseFloat(change) >= 0 ? '+' : ''}{change}%
                </div>
              )}
              <div className="mt-1.5 pt-1.5 border-t border-gpw-border grid grid-cols-3 gap-0.5 text-xs text-center">
                {[['1M', perf?.change1M], ['3M', perf?.change3M], ['YTD', perf?.changeYtd]].map(([label, val]) => (
                  <div key={label}>
                    <div className="text-gray-500">{label}</div>
                    <div className={`font-semibold ${pctCls(val)}`}>{fmtPct(val)}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Macro environment */}
      {macro && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
            <div className="text-xs text-gray-400">{exchange === 'NYSE' ? 'Fed Rate' : 'NBP Rate'}</div>
            <div className="text-xl font-bold">{macro.fedRate != null ? `${macro.fedRate}%` : '—'}</div>
            <div className="text-xs text-gray-500">{macro.source === 'FRED' ? 'FRED live' : 'NBP static'}</div>
          </div>
          <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
            <div className="text-xs text-gray-400">CPI (r/r)</div>
            <div className="text-xl font-bold">{macro.cpi != null ? `${macro.cpi}%` : '—'}</div>
            <div className="text-xs text-gray-500">inflacja</div>
          </div>
          <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
            <div className="text-xs text-gray-400">Makro</div>
            <div className={`text-xl font-bold ${macro.status === 'RYZYKOWNE' ? 'text-gpw-red' : macro.status === 'UWAGA' ? 'text-yellow-400' : 'text-gpw-green'}`}>
              {macro.status === 'RYZYKOWNE' ? '🔴' : macro.status === 'UWAGA' ? '🟡' : '🟢'} {macro.status}
            </div>
            <div className="text-xs text-gray-500">{macro.scoreAdjustment !== 0 ? `score ${macro.scoreAdjustment > 0 ? '+' : ''}${macro.scoreAdjustment} pkt` : 'brak korekty'}</div>
          </div>
        </div>
      )}

      {/* Chart + picker */}
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Wykres 60 dni — zmiana %</h2>
          <button
            onClick={() => setPickerOpen(o => !o)}
            className="text-xs border border-gpw-border hover:border-gray-400 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            {pickerOpen ? 'Zamknij' : '+ Wybierz spółki'}
          </button>
        </div>

        {/* Ticker picker */}
        {pickerOpen && (
          <div className="mb-4 space-y-2">
            <input
              placeholder="Szukaj tickera…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gpw-dark border border-gpw-border rounded px-3 py-1.5 text-sm"
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filtered.map(t => {
                const checked = selectedTickers.includes(t)
                const disabled = !checked && selectedTickers.length >= 3
                return (
                  <label
                    key={t}
                    className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm transition-colors ${
                      disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gpw-dark'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleTicker(t)}
                      className="accent-blue-500"
                    />
                    <span className="font-bold">{tickerLabel(t)}</span>
                    {checked && (
                      <span
                        className="ml-auto w-2.5 h-2.5 rounded-full"
                        style={{ background: LINE_COLORS[selectedTickers.indexOf(t)] }}
                      />
                    )}
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-gray-500">Wybierz max 3 spółki. Wykres pokazuje % zmianę od początku okresu.</p>
          </div>
        )}

        {/* Selected ticker badges */}
        {selectedTickers.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {selectedTickers.map((t, i) => (
              <span
                key={t}
                className="flex items-center gap-1 text-xs border border-gpw-border rounded px-2 py-0.5 cursor-pointer hover:border-red-500 hover:text-red-400 transition-colors"
                style={{ borderColor: LINE_COLORS[i] + '80' }}
                onClick={() => toggleTicker(t)}
                title="Kliknij aby usunąć"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: LINE_COLORS[i] }} />
                {tickerLabel(t)} ✕
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="h-48 flex items-center justify-center text-gray-500">Ładowanie…</div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
            Wybierz spółki aby zobaczyć wykres
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' }}
                formatter={(v, name) => [`${v > 0 ? '+' : ''}${v}%`, name]}
              />
              <Legend />
              {selectedTickers.map((t, i) => (
                tickerCandles[t]?.length > 0 && (
                  <Line
                    key={t}
                    type="monotone"
                    dataKey={tickerLabel(t)}
                    stroke={LINE_COLORS[i]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                )
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent alerts */}
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Ostatnie alerty</h2>
        {recentAlerts.length === 0 ? (
          <p className="text-gray-400 text-sm">Brak alertów — alerty pojawią się gdy strategie wykryją sygnały.</p>
        ) : (
          <div className="space-y-2">
            {recentAlerts.map(a => {
              const cur  = a.exchange === 'NYSE' ? 'USD' : 'PLN'
              const date = new Date(a.timestamp)
              return (
                <div key={a.id} className="flex justify-between items-center text-sm border-b border-gpw-border pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className="font-bold">{(a.ticker ?? '').replace(/\.pl$/i, '').toUpperCase()}</span>
                    <span className="ml-2 text-xs text-gray-400">{a.strategy} · {a.signal}</span>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    <div>{a.price} {cur}</div>
                    <div>{date.toLocaleDateString('pl-PL')}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
