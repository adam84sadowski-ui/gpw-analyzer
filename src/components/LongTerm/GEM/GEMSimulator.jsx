import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'

function pct(v) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${((v - 1) * 100).toFixed(1)}%`
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-xs space-y-1">
      <div className="text-gray-400 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {pct(p.value)}
        </div>
      ))}
    </div>
  )
}

export default function GEMSimulator() {
  const [data, setData]     = useState(null)
  const [loading, setLoad]  = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    setLoad(true)
    fetch('/api/market?mode=gem-simulate')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => { setData(json); setLoad(false) })
      .catch(e => { setError(`Błąd: ${e}`); setLoad(false) })
  }, [])

  if (loading) {
    return (
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Symulator GEM (5 lat)</div>
        <p className="text-sm text-gray-500 animate-pulse">Ładowanie danych historycznych…</p>
      </div>
    )
  }

  if (error || !data?.curve?.length) {
    return (
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Symulator GEM (5 lat)</div>
        <p className="text-sm text-gray-500">{error ?? 'Brak danych symulacji.'}</p>
      </div>
    )
  }

  const { curve, gemReturn, vwceReturn, cspxReturn } = data

  const chartData = curve.map(p => ({
    date:  p.date ? p.date.slice(0, 7) : '',
    GEM:   p.gem  != null ? +p.gem.toFixed(4)  : undefined,
    VWCE:  p.vwce != null ? +p.vwce.toFixed(4) : undefined,
    CSPX:  p.cspx != null ? +p.cspx.toFixed(4) : undefined,
  }))

  // thin out to monthly (already monthly from simulate)
  const tickEvery = Math.ceil(chartData.length / 8)
  const ticks = chartData
    .filter((_, i) => i % tickEvery === 0)
    .map(d => d.date)

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-4">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Symulator GEM (5 lat)</div>

      <div className="flex flex-wrap gap-4 text-xs">
        <div className="space-y-0.5">
          <div className="text-gray-500">GEM (momentum)</div>
          <div className={`text-lg font-bold ${(gemReturn ?? 0) >= 1 ? 'text-green-400' : 'text-red-400'}`}>{pct(gemReturn)}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-gray-500">VWCE (kup i trzymaj)</div>
          <div className={`text-lg font-bold ${(vwceReturn ?? 0) >= 1 ? 'text-green-400' : 'text-red-400'}`}>{pct(vwceReturn)}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-gray-500">CSPX (S&P 500)</div>
          <div className={`text-lg font-bold ${(cspxReturn ?? 0) >= 1 ? 'text-green-400' : 'text-red-400'}`}>{pct(cspxReturn)}</div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <XAxis
            dataKey="date"
            ticks={ticks}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={v => `${((v - 1) * 100).toFixed(0)}%`}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
            formatter={(value) => <span style={{ color: '#9ca3af' }}>{value}</span>}
          />
          <ReferenceLine y={1} stroke="#374151" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="GEM"  stroke="#60a5fa" dot={false} strokeWidth={2} name="GEM" connectNulls />
          <Line type="monotone" dataKey="VWCE" stroke="#4ade80" dot={false} strokeWidth={1.5} name="VWCE" connectNulls />
          <Line type="monotone" dataKey="CSPX" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="CSPX" connectNulls />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-gray-600">
        Symulacja historyczna. Wyniki przeszłe nie gwarantują przyszłych. Podatek Belki (19%) nie uwzględniony.
      </p>
    </div>
  )
}
