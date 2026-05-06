import { useState, useEffect } from 'react'
import { fetchIndex, fetchDaily } from '../../services/stooq.js'
import { useExchange } from '../../context/ExchangeContext.jsx'
import {
  ResponsiveContainer, ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

const EXCHANGE_CONFIG = {
  GPW: {
    indices:      ['wig20.pl', 'mwig40.pl', 'swig80.pl'],
    indexLabels:  { 'wig20.pl': 'WIG20', 'mwig40.pl': 'mWIG40', 'swig80.pl': 'sWIG80' },
    stocks:       ['pkn.pl', 'kghm.pl', 'pko.pl', 'pzu.pl', 'cdr.pl'],
    stockLabels:  { 'pkn.pl': 'PKN', 'kghm.pl': 'KGHM', 'pko.pl': 'PKO', 'pzu.pl': 'PZU', 'cdr.pl': 'CDR' },
    defaultStock: 'pkn.pl',
    unit:         'PLN',
  },
  NYSE: {
    indices:      ['^gspc', '^ixic', '^dji'],
    indexLabels:  { '^gspc': 'S&P 500', '^ixic': 'NASDAQ', '^dji': 'Dow Jones' },
    stocks:       ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'],
    stockLabels:  { AAPL: 'AAPL', MSFT: 'MSFT', NVDA: 'NVDA', AMZN: 'AMZN', META: 'META' },
    defaultStock: 'AAPL',
    unit:         'USD',
  },
}

export default function Dashboard() {
  const { exchange } = useExchange()
  const config = EXCHANGE_CONFIG[exchange]

  const [indexData, setIndexData] = useState({})
  const [chartData, setChartData] = useState([])
  const [selectedTicker, setSelectedTicker] = useState(config.defaultStock)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setSelectedTicker(EXCHANGE_CONFIG[exchange].defaultStock)
    setIndexData({})
    setChartData([])
  }, [exchange])

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const cfg = EXCHANGE_CONFIG[exchange]
        const [idx, candles] = await Promise.all([
          Promise.all(cfg.indices.map(i => fetchIndex(i, exchange).then(d => ({ ticker: i, data: d })))),
          fetchDaily(selectedTicker, exchange),
        ])
        const idxMap = {}
        idx.forEach(({ ticker, data }) => { idxMap[ticker] = data })
        setIndexData(idxMap)

        const chart = candles.map((c, i, arr) => {
          const slice20 = arr.slice(Math.max(0, i - 19), i + 1).map(x => x.close)
          const sma20 = slice20.reduce((a, b) => a + b, 0) / slice20.length
          const slice50 = arr.slice(Math.max(0, i - 49), i + 1).map(x => x.close)
          const sma50 = slice50.reduce((a, b) => a + b, 0) / slice50.length
          return {
            date: c.date, close: c.close, volume: c.volume,
            sma20: Math.round(sma20 * 100) / 100,
            sma50: Math.round(sma50 * 100) / 100,
          }
        })
        setChartData(chart.slice(-60))
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [selectedTicker, exchange])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {config.indices.map(idx => {
          const d = indexData[idx]
          const close = d ? (d.close ?? parseFloat(d.Close)) : null
          const open  = d ? (d.open  ?? parseFloat(d.Open))  : null
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

      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Wykres 60 dni</h2>
          <select
            value={selectedTicker}
            onChange={e => setSelectedTicker(e.target.value)}
            className="bg-gpw-dark border border-gpw-border text-sm rounded px-2 py-1"
          >
            {config.stocks.map(t => (
              <option key={t} value={t}>{config.stockLabels[t]}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-gray-500">Ładowanie…</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis yAxisId="price" orientation="right" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis yAxisId="vol" orientation="left" tick={{ fill: '#8b949e', fontSize: 10 }} width={40} />
              <Tooltip
                contentStyle={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' }}
                formatter={(v, name) => name === 'Wolumen' ? v?.toLocaleString() : `${v} ${config.unit}`}
              />
              <Legend />
              <Bar yAxisId="vol" dataKey="volume" fill="#30363d" name="Wolumen" />
              <Line yAxisId="price" type="monotone" dataKey="close" stroke="#58a6ff" dot={false} name="Cena" />
              <Line yAxisId="price" type="monotone" dataKey="sma20" stroke="#3fb950" dot={false} strokeDasharray="4 2" name="SMA20" />
              <Line yAxisId="price" type="monotone" dataKey="sma50" stroke="#d29922" dot={false} strokeDasharray="4 2" name="SMA50" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Ostatnie alerty</h2>
        <p className="text-gray-400 text-sm">Brak alertów — uruchom strategię na środowisku staging.</p>
      </div>
    </div>
  )
}
