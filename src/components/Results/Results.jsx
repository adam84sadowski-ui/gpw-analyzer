import { useState, useEffect, useCallback } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { HORIZON } from '../../lib/interpretSignal.js'

function pct(v)          { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmtCur(v, curr) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)} ${curr}` }

function CloseModal({ position, onClose, onConfirm, currency }) {
  const [exitPrice, setExitPrice] = useState(String(position.entryPrice))
  const [priceLoading, setPriceLoading] = useState(true)

  useEffect(() => {
    const exchange = position.exchange ?? 'GPW'
    fetch(`/api/market?mode=current&ticker=${position.ticker}&exchange=${exchange}`)
      .then(r => r.json())
      .then(d => { if (d?.close) setExitPrice(String(d.close)) })
      .catch(() => {})
      .finally(() => setPriceLoading(false))
  }, [])

  const pnlPct = ((Number(exitPrice) - position.entryPrice) / position.entryPrice * 100).toFixed(2)
  const pnlAmt = ((Number(exitPrice) - position.entryPrice) * position.shares).toFixed(2)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gpw-card border border-gpw-border rounded-xl p-6 w-full max-w-sm space-y-4">
        <h3 className="font-semibold text-lg">Zamknij pozycję — {position.tickerDisplay}</h3>
        <div className="text-sm text-gray-400">Cena wejścia: <span className="text-white">{position.entryPrice} {currency}</span></div>
        <label className="block">
          <span className="text-sm text-gray-400">Cena wyjścia ({currency})</span>
          <input
            type="number"
            step="0.01"
            value={exitPrice}
            onChange={e => setExitPrice(e.target.value)}
            disabled={priceLoading}
            placeholder={priceLoading ? 'Pobieranie ceny…' : ''}
            className="mt-1 w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
        <div className={`text-center text-lg font-bold ${Number(pnlAmt) >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
          {pct(Number(pnlPct))} / {fmtCur(Number(pnlAmt), currency)}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-gpw-dark border border-gpw-border py-2 rounded-lg text-sm">Anuluj</button>
          <button
            onClick={() => onConfirm(Number(exitPrice))}
            className="flex-1 bg-gpw-green hover:bg-green-600 text-white py-2 rounded-lg text-sm font-semibold"
          >
            Potwierdź zamknięcie
          </button>
        </div>
      </div>
    </div>
  )
}

function posCurrency(pos) {
  return (pos.exchange ?? 'GPW') === 'NYSE' ? 'USD' : 'PLN'
}

export default function Results() {
  const { exchange } = useExchange()
  const [tab, setTab]               = useState('open')
  const [positions, setPositions]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [prices, setPrices]         = useState({})
  const [closing, setClosing]       = useState(null)
  const [addingTest, setAddingTest] = useState(false)
  const [settings, setSettings]     = useState({ capital: 10000 })
  const [expanded, setExpanded]     = useState(new Set())
  const [indics, setIndics]         = useState({})
  const [names, setNames]           = useState({})
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    fetch('/api/kv?key=settings')
      .then(r => r.json())
      .then(d => { if (d && typeof d === 'object') setSettings(d) })
      .catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/positions?status=${tab}`)
      .then(r => r.json())
      .then(async data => {
        setPositions(data)
        if (tab === 'open' && data.length > 0) {
          const priceMap = {}
          const nameMap  = {}
          await Promise.all(data.map(async pos => {
            if (priceMap[pos.ticker] !== undefined) return
            try {
              const posEx = pos.exchange ?? 'GPW'
              const r = await fetch(`/api/market?mode=current&ticker=${pos.ticker}&exchange=${posEx}`)
              const d = await r.json()
              if (d?.close)     priceMap[pos.ticker] = d.close
              if (d?.shortName) nameMap[pos.ticker]  = d.shortName
            } catch {}
          }))
          setNames(nameMap)
          setPrices(priceMap)
        }
      })
      .catch(() => setPositions([]))
      .finally(() => setLoading(false))
  }, [tab])

  useEffect(() => { load() }, [load])

  async function addTestPosition() {
    setAddingTest(true)
    try {
      const r = await fetch('/api/market?mode=current&ticker=pkn.pl&exchange=GPW')
      const d = await r.json()
      const price = d?.close ?? 48.50
      await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker:       'pkn.pl',
          strategy:     'scalping',
          entryPrice:   price,
          positionSize: 1500,
          target:       5,
          stopLoss:     3,
          signal:       'TEST',
        }),
      })
      load()
    } finally {
      setAddingTest(false)
    }
  }

  async function closePosition(exitPrice) {
    await fetch('/api/positions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: closing.id, exitPrice }),
    })
    setClosing(null)
    load()
  }

  function toggleExpand(pos) {
    const id = pos.id
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); return next }
      next.add(id)
      if (!indics[id]) {
        fetch(`/api/market?mode=indicators&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}&strategy=${pos.strategy}`)
          .then(r => r.json())
          .then(d => setIndics(prev2 => ({ ...prev2, [id]: d })))
          .catch(() => {})
      }
      return next
    })
  }

  function signalComment(pos, cur) {
    if (!cur) return null
    const { signal } = pos
    const { rsi, volMult, sma50Delta } = cur

    if (signal === 'BREAKOUT') {
      if (rsi > 80)       return '⚠️ RSI wykupiony (>80) — ryzyko korekty. Rozważ trailing stop.'
      if (volMult < 1.2)  return '⚠️ Wolumen opada — breakout może być fałszywy. Monitoruj uważnie.'
      if (sma50Delta > 30) return `⚠️ Mocne oddalenie od SMA50 (+${sma50Delta}%) — korekta możliwa.`
      if (volMult >= 2)   return `✅ Wolumen potwierdza breakout (${volMult}x). RSI ${rsi?.toFixed(1)} — trend kontynuowany.`
      return `📊 Breakout aktywny. RSI: ${rsi?.toFixed(1)}, wolumen: ${volMult}x.`
    }

    if (signal === 'RSI_OVERSOLD') {
      if (rsi > 70) return '⚠️ RSI wykupiony (>70) — rozważ realizację zysku.'
      if (rsi > 55) return '💡 RSI wyszedł ze strefy wyprzedania — rozważ realizację zysku.'
      if (rsi < 40) return '✅ RSI nadal w strefie wyprzedania — sygnał aktywny.'
      return `📊 RSI ${rsi?.toFixed(1)} — w normalnym zakresie. Trend wzrostowy.`
    }

    if (signal === 'SMA50_CROSSOVER') {
      if (sma50Delta < 0)  return '⚠️ Cena wróciła pod SMA50 — sygnał osłabiony. Rozważ stop loss.'
      if (sma50Delta > 25) return `⚠️ Duże oddalenie od SMA50 (+${sma50Delta}%) — korekta możliwa.`
      if (sma50Delta > 0)  return '✅ Cena powyżej SMA50 — trend wzrostowy utrzymany.'
      return '📊 SMA50: neutralnie.'
    }

    return null
  }

  async function deletePosition(id) {
    await fetch(`/api/positions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setPositions(prev => prev.filter(p => p.id !== id))
    setDeletingId(null)
  }

  const openPositions = positions.filter(p => p.status === 'open')

  const portfolio = settings.capital ?? 10000

  // Summary totals for current exchange's open positions only
  const exchangeCurrency = exchange === 'NYSE' ? 'USD' : 'PLN'
  const openForExchange  = openPositions.filter(p => (p.exchange ?? 'GPW') === exchange)
  const totalInvested    = openForExchange.reduce((s, p) => s + p.positionSize, 0)
  const totalPnL         = openForExchange.reduce((s, p) => {
    const cp = prices[p.ticker]
    if (!cp) return s
    return s + (cp - p.entryPrice) * p.shares
  }, 0)

  return (
    <div className="space-y-4">
      {closing && <CloseModal position={closing} onClose={() => setClosing(null)} onConfirm={closePosition} currency={posCurrency(closing)} />}

      {/* Podsumowanie */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
          <div className="text-xs text-gray-400 mb-1">Portfel</div>
          <div className="font-bold">{portfolio.toLocaleString('pl-PL')} PLN</div>
        </div>
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
          <div className="text-xs text-gray-400 mb-1">Zainwestowane</div>
          <div className="font-bold">{totalInvested.toLocaleString('pl-PL')} {exchangeCurrency}</div>
        </div>
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 text-center">
          <div className="text-xs text-gray-400 mb-1">P&L (otwarte)</div>
          <div className={`font-bold ${totalPnL >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
            {fmtCur(totalPnL, exchangeCurrency)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-gpw-border">
        <div className="flex flex-1">
          {[['open', 'Aktywne'], ['closed', 'Zamknięte']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                tab === id ? 'border-gpw-blue text-white' : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {label}
              {id === 'open' && openPositions.length > 0 && (
                <span className="ml-1.5 bg-gpw-blue text-white text-xs px-1.5 rounded-full">
                  {openPositions.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={addTestPosition}
          disabled={addingTest}
          className="mb-1 text-xs text-gray-500 hover:text-gray-300 border border-gpw-border hover:border-gray-500 px-2 py-1 rounded transition-colors disabled:opacity-50"
        >
          {addingTest ? '…' : '+ TEST PKN'}
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Ładowanie…</div>
      ) : positions.length === 0 ? (
        <div className="bg-gpw-card border border-gpw-border rounded-lg p-8 text-center text-gray-400 text-sm space-y-3">
          <p>
            {tab === 'open'
              ? 'Brak aktywnych pozycji. Potwierdź rekomendację w zakładce Strategie.'
              : 'Brak zamkniętych pozycji.'}
          </p>
          {tab === 'open' && (
            <button
              onClick={addTestPosition}
              disabled={addingTest}
              className="mx-auto block border border-gpw-border hover:border-gray-400 text-gray-300 px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {addingTest ? 'Dodawanie…' : '+ Dodaj testową pozycję (PKN)'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map(pos => {
            const cur    = posCurrency(pos)
            const cp     = prices[pos.ticker]
            const pnlPct = cp ? ((cp - pos.entryPrice) / pos.entryPrice * 100) : null
            const pnlAmt = cp ? ((cp - pos.entryPrice) * pos.shares) : null

            return (
              <div key={pos.id} className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-3">
                <button
                  onClick={() => toggleExpand(pos)}
                  className="w-full flex justify-between items-start text-left"
                >
                  <div>
                    <span className="font-bold text-lg">{pos.tickerDisplay}</span>
                    {names[pos.ticker] && (
                      <span className="ml-1.5 text-sm text-gray-400">({names[pos.ticker]})</span>
                    )}
                    <span className="ml-2 text-xs text-gray-400">{pos.strategy}</span>
                    <span className="ml-1 text-xs text-gray-500">{cur}</span>
                    {pos.entryScore != null && (
                      <span className="ml-2 text-xs text-yellow-400">⭐ {pos.entryScore}/100</span>
                    )}
                  </div>
                  <div className="text-right flex items-center gap-2">
                    {pos.status === 'open' && cp && (
                      <div className={`font-bold text-lg ${pnlPct >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                        {pct(pnlPct)}
                      </div>
                    )}
                    {pos.status === 'closed' && (
                      <div className={`font-bold text-lg ${pos.pnlPct >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                        {pct(pos.pnlPct)}
                      </div>
                    )}
                    <span className="text-gray-500 text-xs">{expanded.has(pos.id) ? '▲' : '▼'}</span>
                  </div>
                </button>

                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="bg-gpw-dark rounded p-1.5">
                    <div className="text-gray-400">Wejście</div>
                    <div className="font-bold">{pos.entryPrice} {cur}</div>
                  </div>
                  <div className="bg-gpw-dark rounded p-1.5">
                    <div className="text-gray-400">{pos.status === 'open' ? 'Teraz' : 'Wyjście'}</div>
                    <div className="font-bold">{pos.status === 'open' ? (cp ?? '…') : pos.exitPrice} {cur}</div>
                  </div>
                  <div className="bg-gpw-dark rounded p-1.5">
                    <div className="text-gray-400">Wartość P&L</div>
                    <div className={`font-bold ${(pnlAmt ?? pos.pnlAmt ?? 0) >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                      {fmtCur(pnlAmt ?? pos.pnlAmt ?? 0, cur)}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between text-xs text-gray-500">
                  <span>Akcji: {pos.shares} × {pos.entryPrice} {cur} = {pos.positionSize.toLocaleString('pl-PL')} {cur}</span>
                  <span>{new Date(pos.entryDate).toLocaleDateString('pl-PL')}</span>
                </div>

                {pos.entryRsi != null && (
                  <div className="text-xs text-gray-500">
                    RSI przy wejściu: <span className={`font-semibold ${pos.entryRsi < 30 ? 'text-gpw-green' : pos.entryRsi > 70 ? 'text-gpw-red' : 'text-gray-300'}`}>{pos.entryRsi.toFixed(1)}</span>
                  </div>
                )}

                {pos.status === 'open' && (
                  <div className="flex gap-2 text-xs">
                    <div className="flex-1 text-center bg-gpw-dark rounded p-1.5">
                      🎯 Cel: <span className="text-gpw-green">+{pos.target}%</span>
                      <span className="text-gray-400 ml-1">({(pos.entryPrice * (1 + pos.target / 100)).toFixed(2)} {cur})</span>
                    </div>
                    <div className="flex-1 text-center bg-gpw-dark rounded p-1.5">
                      🛑 Stop: {pos.trailingActive
                        ? <><span className="text-yellow-400 font-semibold">{pos.trailingStopPrice?.toFixed(2)} {cur}</span><span className="text-yellow-500 ml-1">(trailing)</span></>
                        : <><span className="text-gpw-red">-{pos.stopLoss}%</span><span className="text-gray-400 ml-1">({(pos.entryPrice * (1 - pos.stopLoss / 100)).toFixed(2)} {cur})</span></>
                      }
                    </div>
                  </div>
                )}

                {pos.status === 'open' && pos.strategy !== 'aggressive' && (() => {
                  const maxDays  = HORIZON[pos.strategy]?.maxDays ?? 5
                  const entryDay = new Date(pos.entryDate.slice(0, 10))
                  const today    = new Date(new Date().toISOString().slice(0, 10))
                  const daysHeld = Math.round((today - entryDay) / 86400000)
                  const daysLeft = maxDays - daysHeld
                  const pct      = Math.min(100, Math.round(daysHeld / maxDays * 100))
                  const barColor = pct >= 100 ? 'bg-gpw-red' : pct >= 80 ? 'bg-yellow-400' : 'bg-gpw-blue'
                  return (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">⏱ Czas pozycji</span>
                        <span className={daysLeft < 0 ? 'text-gpw-red' : daysLeft <= 1 ? 'text-yellow-400' : 'text-gray-300'}>
                          {daysHeld} {daysHeld === 1 ? 'dzień' : 'dni'}
                          {daysLeft >= 0
                            ? <> / pozostało <span className="font-semibold">{daysLeft} dni</span></>
                            : <> / <span className="font-semibold">⏰ przekroczono o {Math.abs(daysLeft)} dni</span></>
                          }
                        </span>
                      </div>
                      <div className="w-full bg-gpw-dark rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })()}

                {/* ── Expand panel: wskaźniki ── */}
                {expanded.has(pos.id) && (() => {
                  const cur = indics[pos.id]
                  const comment = signalComment(pos, cur)
                  const trendLabel = t => t === 'up' ? '📈 wzrostowy' : t === 'down' ? '📉 spadkowy' : t ? '➡️ neutralny' : '—'
                  const delta = (entry, now) => {
                    if (entry == null || now == null) return null
                    const d = now - entry
                    return { d, cls: d > 0 ? 'text-gpw-green' : d < 0 ? 'text-gpw-red' : 'text-gray-400', arrow: d > 0 ? '↑' : d < 0 ? '↓' : '→' }
                  }
                  const rsiPeriod = pos.entryRsiPeriod ?? cur?.rsiPeriod ?? 14
                  const rsiDelta  = delta(pos.entryRsi,        cur?.rsi)
                  const volDelta  = delta(pos.entryVolMult,    cur?.volMult)
                  const smaDelta  = delta(pos.entrySma50Delta, cur?.sma50Delta)
                  const sma150Label = t => t === 'above' ? '✅ powyżej' : t === 'below' ? '⚠️ poniżej' : null
                  const sma150Changed = pos.entrySma150trend && cur?.sma150trend && pos.entrySma150trend !== cur.sma150trend
                  const indexName = pos.exchange === 'NYSE' ? 'S&P500' : 'WIG20'
                  const noEntryData = pos.entryVolMult == null && pos.entrySma50Delta == null
                  return (
                    <div className="border-t border-gpw-border pt-3 space-y-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Wskaźniki przy wejściu → teraz</p>
                      {noEntryData && (
                        <p className="text-xs text-gray-600 italic">Dane z wejścia niedostępne — pozycja otwarta przed v1.21</p>
                      )}
                      <div className="grid grid-cols-4 gap-1 text-xs text-center">
                        <div className="text-gray-500"></div>
                        <div className="text-gray-500">Wejście</div>
                        <div className="text-gray-500">Teraz</div>
                        <div className="text-gray-500">Zmiana</div>

                        <div className="text-gray-400 text-left">RSI({rsiPeriod})</div>
                        <div>{pos.entryRsi != null ? pos.entryRsi.toFixed(1) : '—'}</div>
                        <div>{cur ? cur.rsi?.toFixed(1) ?? '—' : '…'}</div>
                        <div className={rsiDelta?.cls ?? ''}>{rsiDelta ? `${rsiDelta.d > 0 ? '+' : ''}${rsiDelta.d.toFixed(1)} ${rsiDelta.arrow}` : '—'}</div>

                        <div className="text-gray-400 text-left">Wolumen</div>
                        <div>{pos.entryVolMult != null ? `${pos.entryVolMult}x` : '—'}</div>
                        <div>{cur ? `${cur.volMult}x` : '…'}</div>
                        <div className={volDelta?.cls ?? ''}>{volDelta ? `${volDelta.d > 0 ? '+' : ''}${volDelta.d.toFixed(1)}x ${volDelta.arrow}` : '—'}</div>

                        <div className="text-gray-400 text-left">vs SMA50</div>
                        <div>{pos.entrySma50Delta != null ? `${pos.entrySma50Delta > 0 ? '+' : ''}${pos.entrySma50Delta}%` : '—'}</div>
                        <div>{cur?.sma50Delta != null ? `${cur.sma50Delta > 0 ? '+' : ''}${cur.sma50Delta}%` : '…'}</div>
                        <div className={smaDelta?.cls ?? ''}>{smaDelta ? `${smaDelta.d > 0 ? '+' : ''}${smaDelta.d.toFixed(1)}pp ${smaDelta.arrow}` : '—'}</div>

                        <div className="text-gray-400 text-left">SMA150</div>
                        <div>{sma150Label(pos.entrySma150trend) ?? '—'}</div>
                        <div>{cur ? (sma150Label(cur.sma150trend) ?? '—') : '…'}</div>
                        <div className={sma150Changed ? 'text-gpw-red' : 'text-gray-400'}>{sma150Changed ? (cur.sma150trend === 'below' ? '⬇️ zmiana' : '⬆️ zmiana') : '—'}</div>

                        <div className="text-gray-400 text-left">{indexName}</div>
                        <div className="col-span-3 text-left">{trendLabel(pos.entryIndexTrend)}</div>

                        {pos.entryNearSupport != null && (
                          <>
                            <div className="text-gray-400 text-left">Wsparcie</div>
                            <div className="col-span-3 text-left text-blue-400">{pos.entryNearSupport}</div>
                          </>
                        )}
                      </div>
                      {comment && (
                        <div className="text-xs text-gray-300 bg-gpw-dark rounded-lg px-3 py-2">{comment}</div>
                      )}
                    </div>
                  )
                })()}

                {pos.status === 'open' && (
                  <button
                    onClick={() => setClosing(pos)}
                    className="w-full border border-gpw-border hover:border-gray-500 text-gray-300 py-2 rounded-lg text-sm transition-colors"
                  >
                    Zamknij pozycję
                  </button>
                )}

                {pos.status === 'closed' && (
                  deletingId === pos.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => deletePosition(pos.id)}
                        className="flex-1 bg-red-900/40 border border-red-800 hover:bg-red-900/70 text-red-300 py-2 rounded-lg text-sm transition-colors"
                      >
                        Tak, usuń
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="flex-1 border border-gpw-border hover:border-gray-500 text-gray-400 py-2 rounded-lg text-sm transition-colors"
                      >
                        Anuluj
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(pos.id)}
                      className="w-full border border-gpw-border hover:border-red-900 text-gray-500 hover:text-red-400 py-2 rounded-lg text-sm transition-colors"
                    >
                      Usuń z historii
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-gray-500 text-center">
        ⚠️ Dane edukacyjne. Ceny z ~15 min opóźnieniem. Nie stanowią porady inwestycyjnej.
      </p>
    </div>
  )
}
