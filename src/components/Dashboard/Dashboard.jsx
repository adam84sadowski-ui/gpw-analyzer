import { useState, useEffect } from 'react'
import { fetchIndex, fetchDaily } from '../../services/stooq.js'
import { tickerDisplay } from '../../utils/formatting.js'
import {
  ResponsiveContainer, ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

const INDICES = ['wig20.pl', 'mwig40.pl', 'swig80.pl']

export default function Dashboard() {
  const [indexData, setIndexData] = useState({})
  const [chartData, setChartData] = useState([])
  const [selectedTicker, setSelectedTicker] = useState('pkn.pl')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [idx, candles] = await Promise.all([
          Promise.all(INDICES.map(i => fetchIndex(i).then(d => ({ ticker: i, data: d })))),
          fetchDaily(selectedTicker),
        ])
        const idxMap = {}
        idx.forEach(({ ticker, data }) => { idxMap[ticker] = data })
        setIndexData(idxMap)

        const sma20Window = 20
        const chart = candles.map((c, i, arr) => {
          const slice20 = arr.slice(Math.max(0, i - sma20Window + 1), i + 1).map(x => x.close)
          const sma20 = slice20.reduce((a, b) => a + b, 0) / slice20.length
          const slice50 = arr.slice(Math.max(0, i - 49), i + 1).map(x => x.close)
          const sma50 = slice50.reduce((a, b) => a + b, 0) / slice50.length
          return { date: c.date, close: c.close, volume: c.volume, sma20: Math.round(sma20 * 100) / 100, sma50: Math.round(sma50 * 100) / 100 }
        })
        setChartData(chart.slice(-60))
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [selectedTicker])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {INDICES.map(idx => {
          const d = indexData[idx]
          const close = d ? parseFloat(d.Close) : null
          const open  = d ? parseFloat(d.Open) : null
          const change = close && open ? ((close - open) / open * 100).toFixed(2) : null
          return (
            <div key={idx} className="bg-gpw-card border border-gpw-border rounded-lg p-4">
              <div className="text-xs text-gray-400">{tickerDisplay(idx)}</div>
              <div className="text-xl font-bold">{close?.toFixed(0) ?? '—'}</div>
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
            {['pkn.pl', 'kghm.pl', 'pko.pl', 'pzu.pl', 'cdr.pl'].map(t => (
              <option key={t} value={t}>{tickerDisplay(t)}</option>
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
              <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' }} />
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
