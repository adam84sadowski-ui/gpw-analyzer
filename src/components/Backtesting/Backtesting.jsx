import { useState } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { allTickers } from '../../lib/universes.js'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'

const STRATEGIES      = ['scalping', 'swing', 'aggressive']
const STRATEGY_LABELS = { scalping: '⚡ Scalping', swing: '📈 Swing', aggressive: '🚀 Agresywna' }
const EXIT_ICON       = { target: '🎯', stop: '🛑', horizon: '⏰' }

function tickerLabel(t) { return t.replace(/\.pl$/i, '').toUpperCase() }

export default function Backtesting() {
  const { exchange } = useExchange()
  const [ticker,   setTicker]   = useState('')
  const [strategy, setStrategy] = useState('scalping')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')

  async function runBacktest() {
    if (!ticker.trim()) { setError('Podaj ticker'); return }
    setError('')
    setLoading(true)
    setResult(null)
    try {
      const r = await fetch(`/api/market?mode=backtest&ticker=${encodeURIComponent(ticker.trim())}&strategy=${strategy}&exchange=${exchange}`)
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? 'Błąd backtestingu'); return }
      setResult(d)
    } catch {
      setError('Błąd połączenia z serwerem')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* Input */}
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">🔬 Backtest strategii</h2>
        <div className="flex gap-3 flex-wrap">
          <input
            list="bt-tickers"
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runBacktest()}
            placeholder={exchange === 'GPW' ? 'np. pkn.pl' : 'np. AAPL'}
            className="flex-1 min-w-32 bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          />
          <datalist id="bt-tickers">
            {allTickers(exchange).map(t => <option key={t} value={t}>{tickerLabel(t)}</option>)}
          </datalist>
          <select
            value={strategy}
            onChange={e => setStrategy(e.target.value)}
            className="bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          >
            {STRATEGIES.map(s => <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>)}
          </select>
          <button
            onClick={runBacktest}
            disabled={loading}
            className="bg-gpw-blue hover:bg-blue-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            {loading ? 'Analizuję…' : 'Uruchom'}
          </button>
        </div>
        {error && <p className="text-gpw-red text-sm">{error}</p>}
        <p className="text-xs text-gray-500">
          Symulacja na ~1 roku danych historycznych. Wyniki tylko edukacyjne — nie stanowią rekomendacji inwestycyjnych.
        </p>
      </div>

      {loading && (
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-10 text-center text-gray-400 text-sm">
          Analizuję dane historyczne…
        </div>
      )}

      {result && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Sygnałów',     value: String(result.trades.length) },
              { label: 'Win rate',     value: `${result.winRate}%`,  color: result.winRate  >= 50 ? 'text-gpw-green' : 'text-gpw-red' },
              { label: 'Avg wynik',    value: `${result.avgGain >= 0 ? '+' : ''}${result.avgGain}%`, color: result.avgGain >= 0 ? 'text-gpw-green' : 'text-gpw-red' },
              { label: 'Max drawdown', value: `-${result.maxDrawdown}%`, color: 'text-gpw-red' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
                <div className="text-xs text-gray-400">{label}</div>
                <div className={`text-xl font-bold mt-0.5 ${color ?? ''}`}>{value}</div>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            {tickerLabel(result.ticker)} · {STRATEGY_LABELS[result.strategy]} · {result.period} ({result.candles} sesji)
          </p>

          {/* Equity curve */}
          <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">Krzywa kapitału</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={result.equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickFormatter={v => `${v}%`} domain={['auto', 'auto']} width={45} />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3' }}
                  formatter={v => [`${v}%`, 'Kapitał']}
                />
                <ReferenceLine y={100} stroke="#8b949e" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="equity" stroke="#58a6ff" dot={false} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Trades table */}
          {result.trades.length > 0 ? (
            <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
              <h3 className="font-semibold mb-3 text-sm">Historia transakcji ({result.trades.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gpw-border">
                      <th className="text-left pb-2">Wejście</th>
                      <th className="text-left pb-2">Wyjście</th>
                      <th className="text-right pb-2">Cena w.</th>
                      <th className="text-right pb-2">Cena wyj.</th>
                      <th className="text-right pb-2">Wynik</th>
                      <th className="text-center pb-2">Powód</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-b border-gpw-border/40 last:border-0">
                        <td className="py-1.5 pr-2">{t.entryDate}</td>
                        <td className="py-1.5 pr-2">{t.exitDate}</td>
                        <td className="py-1.5 text-right pr-2">{t.entry}</td>
                        <td className="py-1.5 text-right pr-2">{t.exit}</td>
                        <td className={`py-1.5 text-right font-semibold pr-2 ${t.gainPct > 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                          {t.gainPct > 0 ? '+' : ''}{t.gainPct}%
                        </td>
                        <td className="py-1.5 text-center text-gray-400">
                          {EXIT_ICON[t.exitReason] ?? ''} {t.exitReason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-gpw-card border border-gpw-border rounded-lg p-6 text-center text-gray-400 text-sm">
              Brak sygnałów w tym okresie dla tej strategii.
            </div>
          )}
        </>
      )}
    </div>
  )
}
