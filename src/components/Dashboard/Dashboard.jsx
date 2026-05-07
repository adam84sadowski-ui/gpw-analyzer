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
  const [tickerCandles,   setTickerCandles]   = useState({})
  const [selectedTickers, setSelectedTickers] = useState([])
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [pickerOpen,      setPickerOpen]      = useState(false)
  const [recentAlerts,    setRecentAlerts]    = useState([])

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

  // Load index cards
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

  // Load recent alerts
  useEffect(() => {
    fetch('/api/alerts?limit=3')
      .then(r => r.json())
      .then(data => setRecentAlerts(Array.isArray(data) ? data : []))
      .catch(() => setRecentAlerts([]))
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
          const close  = d ? (d.close ?? parseFloat(d.Close)) : null
          const open   = d ? (d.open  ?? parseFloat(d.Open))  : null
          const change = close && open && !isNaN(open) ? ((close - open) / open * 100).toFixed(2) : null
          return (
            <div key={idx} className="bg-gpw-card border border-gpw-border rounded-lg p-4">
              <div className="text-xs text-gray-400">{config.indexLabels[idx]}</div>
              <div className="text-xl font-bold">{close?.toLocaleString() ?? '—'}</div>
              {change !== null && (
                <div className={`text-sm ${parseFloat(change) >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                  {parseFloat(change) >= 0 ? '+' : ''}{change}%
                </div>
              )}
            </div>
          )
        })}
      </div>

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
