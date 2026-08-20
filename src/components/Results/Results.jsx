import { useState, useEffect, useCallback } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { HORIZON, interpretPositionState } from '../../lib/interpretSignal.js'
import TechnicalPanel from '../TechnicalPanel.jsx'

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
  const [aiEvals, setAiEvals]       = useState({})  // posId → { loading, result }
  const [progressOpen, setProgressOpen] = useState({})
  const [chatState, setChatState]   = useState({})  // posId → { open, msgs, input, loading }
  const [techPanelOpen, setTechPanelOpen] = useState({})
  const [copiedEval,    setCopiedEval]    = useState({})

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
          data.forEach(pos => {
            fetch(`/api/market?mode=indicators&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}&strategy=${pos.strategy}`)
              .then(r => r.json())
              .then(d => { if (d && !d.error) setIndics(prev => ({ ...prev, [pos.id]: d })) })
              .catch(() => {})
          })
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
    const id = closing.id
    await fetch('/api/positions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, exitPrice }),
    })
    localStorage.removeItem(`chat_pos_${id}`)
    setChatState(s => { const n = { ...s }; delete n[id]; return n })
    setClosing(null)
    load()
  }

  function ensureIndics(pos) {
    if (!indics[pos.id]) {
      fetch(`/api/market?mode=indicators&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}&strategy=${pos.strategy}`)
        .then(r => r.json())
        .then(d => setIndics(prev => ({ ...prev, [pos.id]: d })))
        .catch(() => {})
    }
  }

  function toggleExpand(pos) {
    const id = pos.id
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); return next }
      next.add(id)
      ensureIndics(pos)
      return next
    })
  }

  function toggleProgress(pos) {
    ensureIndics(pos)
    setProgressOpen(s => ({ ...s, [pos.id]: !s[pos.id] }))
  }

  function openChat(pos) {
    setChatState(s => {
      const prev = s[pos.id]
      if (prev?.open) return { ...s, [pos.id]: { ...prev, open: false } }
      let msgs = []
      try { msgs = JSON.parse(localStorage.getItem(`chat_pos_${pos.id}`) ?? '[]') } catch {}
      return { ...s, [pos.id]: { open: true, msgs, input: '', loading: false } }
    })
    ensureIndics(pos)
  }

  async function sendChatMsg(pos, text) {
    if (!text?.trim()) return
    const posId = pos.id
    const cp    = prices[pos.ticker]
    const cur   = posCurrency(pos)
    const pnlPct = cp ? ((cp - pos.entryPrice) / pos.entryPrice * 100).toFixed(2) : null

    let ci = indics[pos.id]
    const [indicRes, newsRes] = await Promise.allSettled([
      ci ? Promise.resolve(ci) : fetch(`/api/market?mode=indicators&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}&strategy=${pos.strategy}`).then(r => r.json()),
      fetch(`/api/market?mode=news&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}`).then(r => r.json()),
    ])
    if (!ci && indicRes.status === 'fulfilled' && !indicRes.value?.error) {
      ci = indicRes.value
      setIndics(prev => ({ ...prev, [pos.id]: ci }))
    }
    const headlines = newsRes.status === 'fulfilled' ? (newsRes.value?.headlines ?? []) : []

    const entryDay  = new Date(pos.entryDate.slice(0, 10))
    const today     = new Date(new Date().toISOString().slice(0, 10))
    const daysHeld  = Math.round((today - entryDay) / 86400000)

    const prevMsgs = chatState[posId]?.msgs ?? []
    const newMsgs  = [...prevMsgs, { role: 'user', content: text.trim() }]
    setChatState(s => ({ ...s, [posId]: { ...s[posId], msgs: newMsgs, input: '', loading: true } }))
    localStorage.setItem(`chat_pos_${posId}`, JSON.stringify(newMsgs))

    const aiEval = aiEvals[posId]?.result
    const aiBlock = aiEval
      ? `\nOCENA AI (Buffett/Lynch):
Akcja: ${aiEval.action} | Pewność: ${aiEval.confidence}% | Pilność: ${aiEval.urgency}
Uzasadnienie: ${aiEval.reason}
Plan działania: ${aiEval.modification}`
      : ''

    const indicsBlock = ci ? `
BIEŻĄCE WSKAŹNIKI:
RSI: ${ci.rsi?.toFixed(1) ?? 'brak'} | Wolumen: ${ci.volMult != null ? ci.volMult + 'x' : 'brak'}
vs SMA50: ${ci.sma50Delta != null ? (ci.sma50Delta > 0 ? '+' : '') + ci.sma50Delta + '%' : 'brak'}
SMA150: ${ci.sma150trend ?? 'brak'} | Score: ${ci.score != null ? ci.score + '/100' : 'brak'}
MACD: ${ci.macd?.trend ?? 'brak'} | Bollinger: ${ci.bollinger?.status ?? 'brak'}
Dywergencja: ${ci.divergence ?? 'brak'} | Wsparcie: ${ci.nearSupport != null ? ci.nearSupport : 'brak'}` : ''

    const newsBlock = headlines.length
      ? `\nNAJNOWSZE NEWSY:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
      : ''

    const system = `Jesteś asystentem inwestycyjnym GPW Analyzer. Analizujesz otwartą pozycję. Masz dostęp do wszystkich bieżących wskaźników i newsów — używaj ich bezpośrednio w odpowiedziach, nie proś użytkownika o ich sprawdzenie.

POZYCJA:
Ticker: ${pos.ticker} | Strategia: ${pos.strategy}
Cena wejścia: ${pos.entryPrice} ${cur} | Akcji: ${pos.shares}
Cel: +${pos.target}% | Stop: -${pos.stopLoss}%
Aktualna cena: ${cp ?? 'nieznana'} ${cur}
P&L: ${pnlPct != null ? pnlPct + '%' : 'nieznany'} | Dni trzymania: ${daysHeld}
RSI przy wejściu: ${pos.entryRsi ?? 'brak'}${indicsBlock}${newsBlock}${aiBlock}

Odpowiadasz po polsku. To analiza edukacyjna — nie jest poradą inwestycyjną.`

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: newMsgs, system }),
      })
      const data = await res.json()
      const updated = [...newMsgs, { role: 'assistant', content: data.content ?? 'Błąd AI.' }]
      setChatState(s => ({ ...s, [posId]: { ...s[posId], msgs: updated, loading: false } }))
      localStorage.setItem(`chat_pos_${posId}`, JSON.stringify(updated))
    } catch {
      setChatState(s => ({ ...s, [posId]: { ...s[posId], loading: false } }))
    }
  }

  function signalComment(pos, cur, currentPrice) {
    return interpretPositionState(pos, currentPrice ?? null, cur)
  }

  async function evaluateWithAI(pos) {
    const cp  = prices[pos.ticker]
    let cur   = indics[pos.id]
    setAiEvals(prev => ({ ...prev, [pos.id]: { loading: true, result: null } }))
    if (!cur) {
      try {
        const r = await fetch(`/api/market?mode=indicators&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}&strategy=${pos.strategy}`)
        const d = await r.json()
        if (d && !d.error) { cur = d; setIndics(prev => ({ ...prev, [pos.id]: d })) }
      } catch {}
    }
    try {
      const entryDay = new Date(pos.entryDate.slice(0, 10))
      const today    = new Date(new Date().toISOString().slice(0, 10))
      const daysHeld = Math.round((today - entryDay) / 86400000)
      const pnlPct   = cp ? ((cp - pos.entryPrice) / pos.entryPrice * 100).toFixed(2) : 0
      const params   = new URLSearchParams({
        mode:          'ai-evaluate',
        ticker:        pos.ticker,
        exchange:      pos.exchange ?? 'GPW',
        posId:         pos.id,
        strategy:      pos.strategy ?? 'swing',
        currentPrice:  cp ?? pos.entryPrice,
        pnlPct,
        daysHeld,
        rsi:           cur?.rsi        ?? 50,
        volMult:       cur?.volMult    ?? 1,
        sma50Delta:    cur?.sma50Delta ?? 0,
      })
      const res  = await fetch(`/api/market?${params}`)
      const data = await res.json()
      setAiEvals(prev => ({ ...prev, [pos.id]: { loading: false, result: data } }))
      if (data.suggestedTargetPct != null) {
        fetch('/api/positions', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: pos.id, target: data.suggestedTargetPct }),
        }).catch(() => {})
        setPositions(prev => prev.map(p => p.id === pos.id ? { ...p, target: data.suggestedTargetPct } : p))
      }
    } catch {
      setAiEvals(prev => ({ ...prev, [pos.id]: { loading: false, result: null } }))
    }
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

                {pos.status === 'open' && (() => {
                  const ind = indics[pos.id]
                  const macdLabel = t => !t ? '—' : t.includes('bull') ? '↑ bull' : t.includes('bear') ? '↓ bear' : '→'
                  const tiles = [
                    { label: 'RSI teraz',  val: ind ? (ind.rsi?.toFixed(1) ?? '—')                                                          : null },
                    { label: 'Wolumen',    val: ind ? (ind.volMult != null ? `${ind.volMult}x` : '—')                                       : null },
                    { label: 'vs SMA50',   val: ind ? (ind.sma50Delta != null ? `${ind.sma50Delta > 0 ? '+' : ''}${ind.sma50Delta}%` : '—') : null },
                    { label: 'MACD',       val: ind ? macdLabel(ind.macd?.trend)                                                            : null },
                  ]
                  return (
                    <div className="grid grid-cols-4 gap-1.5 text-xs text-center">
                      {tiles.map(({ label, val }) => (
                        <div key={label} className="bg-gpw-dark rounded p-1.5">
                          <div className="text-gray-500 text-[10px]">{label}</div>
                          <div className={`font-bold ${val == null ? 'text-gray-600 animate-pulse' : 'text-gray-200'}`}>
                            {val ?? '…'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                <div className="flex justify-between text-xs text-gray-500">
                  <span>Akcji: {pos.shares} × {pos.entryPrice} {cur} = {pos.positionSize.toLocaleString('pl-PL')} {cur}</span>
                  <span>{new Date(pos.entryDate).toLocaleDateString('pl-PL')}</span>
                </div>

                {pos.entryRsi != null && (
                  <div className="text-xs text-gray-500">
                    RSI przy wejściu: <span className={`font-semibold ${pos.entryRsi < 30 ? 'text-gpw-green' : pos.entryRsi > 70 ? 'text-gpw-red' : 'text-gray-300'}`}>{pos.entryRsi.toFixed(1)}</span>
                  </div>
                )}

                {pos.status === 'closed' && (pos.entryVolMult != null || pos.entryScore != null) && (
                  <div className="flex gap-1.5 flex-wrap">
                    {pos.entryVolMult != null && (
                      <span className="bg-gpw-dark text-xs rounded px-2 py-1 text-gray-400">
                        Vol wejścia: <span className="text-gray-200 font-bold">{pos.entryVolMult}x</span>
                      </span>
                    )}
                    {pos.entryScore != null && (
                      <span className="bg-gpw-dark text-xs rounded px-2 py-1 text-gray-400">
                        Score: <span className="text-yellow-400 font-bold">{pos.entryScore}/100</span>
                      </span>
                    )}
                  </div>
                )}

                {pos.status === 'open' && (
                  <div className="flex gap-2 text-xs">
                    <div className="flex-1 text-center bg-gpw-dark rounded p-1.5">
                      🎯 Cel: <span className="text-gpw-green">+{pos.target}%</span>
                      {aiEvals[pos.id]?.result?.suggestedTargetPct != null && <span className="text-[10px] text-gpw-blue ml-0.5">🤖</span>}
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

                {/* ── Jak idzie pozycja? ── */}
                {pos.status === 'open' && (
                  <div className="border-t border-gpw-border pt-2">
                    <button
                      onClick={() => toggleProgress(pos)}
                      className="w-full text-left text-xs text-gray-400 hover:text-white flex items-center justify-between py-1 transition-colors"
                    >
                      <span>📊 Jak idzie pozycja?</span>
                      <span>{progressOpen[pos.id] ? '▲' : '▼'}</span>
                    </button>
                    {progressOpen[pos.id] && (() => {
                      const cp  = prices[pos.ticker]
                      const cur = indics[pos.id]
                      const pnlPct      = cp != null ? (cp - pos.entryPrice) / pos.entryPrice * 100 : null
                      const targetPct   = pos.target
                      const stopPct     = pos.stopLoss
                      const toTarget    = pnlPct != null && targetPct ? Math.min(100, Math.max(0, pnlPct / targetPct * 100)) : null
                      const stopBuffer  = pnlPct != null && stopPct != null ? pnlPct + stopPct : null
                      const rsiNow      = cur?.rsi
                      const rsiEntry    = pos.entryRsi
                      const rsiDelta    = rsiEntry != null && rsiNow != null ? rsiNow - rsiEntry : null
                      const volNow      = cur?.volMult
                      const volDelta    = pos.entryVolMult != null && volNow != null ? +(volNow - pos.entryVolMult).toFixed(2) : null
                      const sma50Now    = cur?.sma50Delta
                      const sma50Prog   = pos.entrySma50Delta != null && sma50Now != null ? +(sma50Now - pos.entrySma50Delta).toFixed(1) : null
                      const verdict     = signalComment(pos, cur, cp)

                      const pnlCls = pnlPct == null ? 'text-gray-400'
                        : pnlPct >= 0 ? 'text-gpw-green' : 'text-gpw-red'
                      const stopCls = stopBuffer == null ? 'text-gray-400'
                        : stopBuffer <= 0 ? 'text-gpw-red'
                        : stopBuffer < stopPct * 0.3 ? 'text-gpw-red'
                        : stopBuffer < stopPct ? 'text-yellow-400'
                        : 'text-gray-300'

                      return (
                        <div className="mt-1 space-y-3 text-xs bg-gpw-card rounded-lg p-3">
                          {/* P&L progress to target */}
                          {pnlPct != null && targetPct != null && (
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Postęp do celu (+{targetPct}%)</span>
                                <span className={pnlCls}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
                              </div>
                              <div className="w-full bg-gpw-dark rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full transition-all ${pnlPct >= 0 ? 'bg-gpw-green' : 'bg-gpw-red'}`}
                                  style={{ width: `${Math.min(100, Math.abs(toTarget ?? 0))}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-gray-500">
                                <span>0%</span>
                                <span>{toTarget != null ? `${toTarget.toFixed(0)}% celu` : '—'}</span>
                                <span>+{targetPct}%</span>
                              </div>
                            </div>
                          )}

                          {/* Stop buffer */}
                          {stopBuffer != null && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Bufor do stop loss (-{stopPct}%)</span>
                              <span className={stopCls}>
                                {stopBuffer > 0 ? `${stopBuffer.toFixed(1)}% buforu` : '⛔ Stop przekroczony'}
                              </span>
                            </div>
                          )}

                          {/* RSI delta */}
                          {(rsiEntry != null || rsiNow != null) && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">RSI przy wejściu → teraz</span>
                              <span>
                                {rsiEntry != null ? rsiEntry.toFixed(1) : '—'}
                                {' → '}
                                {cur ? (rsiNow?.toFixed(1) ?? '—') : <span className="animate-pulse">…</span>}
                                {rsiDelta != null && (
                                  <span className={`ml-1 ${rsiDelta > 0 ? 'text-gpw-green' : rsiDelta < 0 ? 'text-gpw-red' : 'text-gray-400'}`}>
                                    ({rsiDelta > 0 ? '+' : ''}{rsiDelta.toFixed(1)} {rsiDelta > 0 ? '↑' : '↓'})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}

                          {/* Volume delta */}
                          {(pos.entryVolMult != null || volNow != null) && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Wolumen przy wejściu → teraz</span>
                              <span>
                                {pos.entryVolMult != null ? `${pos.entryVolMult}x` : '—'}
                                {' → '}
                                {cur ? (volNow != null ? `${volNow}x` : '—') : <span className="animate-pulse">…</span>}
                                {volDelta != null && (
                                  <span className={`ml-1 ${volDelta > 0 ? 'text-gpw-green' : volDelta < 0 ? 'text-gpw-red' : 'text-gray-400'}`}>
                                    ({volDelta > 0 ? '+' : ''}{volDelta}x {volDelta > 0 ? '↑' : '↓'})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}

                          {/* vs SMA50 delta */}
                          {(pos.entrySma50Delta != null || sma50Now != null) && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">vs SMA50 przy wejściu → teraz</span>
                              <span>
                                {pos.entrySma50Delta != null ? `${pos.entrySma50Delta > 0 ? '+' : ''}${pos.entrySma50Delta}%` : '—'}
                                {' → '}
                                {cur ? (sma50Now != null ? `${sma50Now > 0 ? '+' : ''}${sma50Now}%` : '—') : <span className="animate-pulse">…</span>}
                                {sma50Prog != null && (
                                  <span className={`ml-1 ${sma50Prog > 0 ? 'text-gpw-green' : sma50Prog < 0 ? 'text-gpw-red' : 'text-gray-400'}`}>
                                    ({sma50Prog > 0 ? '+' : ''}{sma50Prog}pp {sma50Prog > 0 ? '↑' : '↓'})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}

                          {/* Score delta */}
                          {pos.entryScore != null && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Score przy wejściu → teraz</span>
                              <span>
                                <span className="text-yellow-400">{pos.entryScore}/100</span>
                                {' → '}
                                {cur
                                  ? cur.score != null
                                    ? (() => {
                                        const d = cur.score - pos.entryScore
                                        return (
                                          <>
                                            <span className={cur.score >= 80 ? 'text-gpw-green' : cur.score >= 60 ? 'text-yellow-400' : 'text-gray-300'}>{cur.score}/100</span>
                                            {d !== 0 && (
                                              <span className={`ml-1 ${d > 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                                                ({d > 0 ? '+' : ''}{d} {d > 0 ? '↑' : '↓'})
                                              </span>
                                            )}
                                          </>
                                        )
                                      })()
                                    : '—'
                                  : <span className="animate-pulse">…</span>
                                }
                              </span>
                            </div>
                          )}

                          {/* Verdict */}
                          {cur && verdict && (
                            <p className="text-gray-300 leading-relaxed border-t border-gpw-border pt-2">{verdict}</p>
                          )}
                          {!cur && (
                            <p className="text-gray-500 italic animate-pulse">Ładuję aktualne wskaźniki…</p>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* ── Chat per pozycja ── */}
                {pos.status === 'open' && (
                  <div className="border-t border-gpw-border pt-2">
                    <button
                      onClick={() => openChat(pos)}
                      className="w-full text-left text-xs text-gray-400 hover:text-white flex items-center justify-between py-1 transition-colors"
                    >
                      <span>💬 Porozmawiaj z AI o tej pozycji</span>
                      <span>{chatState[pos.id]?.open ? '▲' : '▼'}</span>
                    </button>
                    {chatState[pos.id]?.open && (
                      <div className="mt-1 bg-gpw-card rounded-lg p-3 space-y-2">
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {(chatState[pos.id]?.msgs?.length ?? 0) === 0 && (
                            <p className="text-xs text-gray-500 italic">Zapytaj AI o tę pozycję — kiedy wyjść, jak interpretować wskaźniki, co obserwować...</p>
                          )}
                          {chatState[pos.id]?.msgs?.map((m, i) => (
                            <div key={i} className={`text-xs rounded p-2 leading-relaxed ${m.role === 'user' ? 'bg-gpw-blue/20 text-white' : 'bg-gpw-dark text-gray-300'}`}>
                              <span className="text-gray-500 text-[10px] block mb-0.5">{m.role === 'user' ? 'Ty' : 'AI'}</span>
                              {m.content}
                            </div>
                          ))}
                          {chatState[pos.id]?.loading && (
                            <p className="text-xs text-gray-400 animate-pulse">AI odpowiada…</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Zapytaj o tę pozycję…"
                            value={chatState[pos.id]?.input ?? ''}
                            onChange={e => setChatState(s => ({ ...s, [pos.id]: { ...s[pos.id], input: e.target.value } }))}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) sendChatMsg(pos, chatState[pos.id]?.input ?? '') }}
                            className="flex-1 bg-gpw-dark border border-gpw-border rounded px-2 py-1.5 text-xs outline-none focus:border-gpw-blue"
                            disabled={chatState[pos.id]?.loading}
                          />
                          <button
                            onClick={() => sendChatMsg(pos, chatState[pos.id]?.input ?? '')}
                            disabled={chatState[pos.id]?.loading || !chatState[pos.id]?.input?.trim()}
                            className="bg-gpw-blue hover:bg-blue-600 disabled:opacity-40 text-white px-3 rounded text-xs transition-colors"
                          >
                            →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Expand panel: wskaźniki ── */}
                {expanded.has(pos.id) && (() => {
                  const cur = indics[pos.id]
                  const comment = signalComment(pos, cur, prices[pos.ticker])
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

                        {pos.entryScore != null && (
                          <>
                            <div className="text-gray-400 text-left">Score</div>
                            <div className="text-yellow-400">{pos.entryScore}/100</div>
                            <div className={cur?.score != null ? (cur.score >= 80 ? 'text-gpw-green' : cur.score >= 60 ? 'text-yellow-400' : 'text-gray-300') : ''}>
                              {cur ? (cur.score != null ? `${cur.score}/100` : '—') : '…'}
                            </div>
                            <div className={(() => { const d = cur?.score != null ? cur.score - pos.entryScore : null; return d != null ? (d > 0 ? 'text-gpw-green' : d < 0 ? 'text-gpw-red' : 'text-gray-400') : '' })()}>
                              {(() => { const d = cur?.score != null ? cur.score - pos.entryScore : null; return d != null ? `${d > 0 ? '+' : ''}${d} ${d > 0 ? '↑' : d < 0 ? '↓' : '→'}` : '—' })()}
                            </div>
                          </>
                        )}

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

                {/* ── Wskaźniki techniczne ── */}
                <div className="border-t border-gpw-border pt-2">
                  <button
                    onClick={() => {
                      const next = !techPanelOpen[pos.id]
                      setTechPanelOpen(s => ({ ...s, [pos.id]: next }))
                      if (next && !indics[pos.id]) {
                        fetch(`/api/market?mode=indicators&ticker=${pos.ticker}&exchange=${pos.exchange ?? 'GPW'}&strategy=${pos.strategy}`)
                          .then(r => r.json())
                          .then(d => { if (d && !d.error) setIndics(prev => ({ ...prev, [pos.id]: d })) })
                          .catch(() => {})
                      }
                    }}
                    className="w-full text-left text-xs text-gray-400 hover:text-white flex items-center justify-between py-1 transition-colors"
                  >
                    <span>📊 Wskaźniki techniczne</span>
                    <span>{techPanelOpen[pos.id] ? '▲' : '▼'}</span>
                  </button>
                  {techPanelOpen[pos.id] && (
                    <div className="pt-2">
                      <TechnicalPanel
                        data={indics[pos.id]}
                        price={prices[pos.ticker]}
                        loading={!indics[pos.id]}
                      />
                    </div>
                  )}
                </div>

                {pos.status === 'open' && (() => {
                  const ev = aiEvals[pos.id]
                  const ACTION_STYLE = {
                    'TRZYMAJ':   { icon: '✅', cls: 'text-gpw-green'  },
                    'ZAMKNIJ':   { icon: '⛔', cls: 'text-gpw-red'    },
                    'ZMODYFIKUJ':{ icon: '⚙️', cls: 'text-yellow-400' },
                  }
                  const URGENCY_STYLE = { 'NISKA':'text-gray-400', 'UMIARKOWANA':'text-yellow-400', 'WYSOKA':'text-gpw-red' }
                  return (
                    <div className="space-y-2">
                      {!ev && (
                        <button
                          onClick={() => evaluateWithAI(pos)}
                          className="w-full bg-gpw-blue hover:bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold transition-colors"
                        >
                          🤖 Oceń pozycję z AI
                        </button>
                      )}
                      {ev?.loading && (
                        <div className="text-xs text-gray-400 text-center py-2 animate-pulse">Analizuję z Claude AI…</div>
                      )}
                      {ev?.result && (() => {
                        const r  = ev.result
                        const as = ACTION_STYLE[r.action] ?? { icon: '—', cls: 'text-gray-400' }
                        return (
                          <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3 space-y-2.5">
                            <div className="flex justify-between items-center">
                              <span className={`text-base font-bold ${as.cls}`}>{as.icon} {r.action}</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-semibold ${URGENCY_STYLE[r.urgency] ?? 'text-gray-400'}`}>
                                  Pilność: {r.urgency}
                                </span>
                                <span className="text-xs text-gray-500">{r.confidence}%</span>
                              </div>
                            </div>
                            <div className="bg-gpw-border rounded-full h-1 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${r.confidence >= 70 ? 'bg-gpw-green' : r.confidence >= 50 ? 'bg-yellow-500' : 'bg-gpw-red'}`}
                                style={{ width: `${r.confidence}%` }}
                              />
                            </div>
                            {r.compositeScore != null && (
                              <div className="bg-gpw-card rounded-lg px-3 py-2 space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-gray-400">Siła tezy: <span className="font-bold text-white">{r.compositeScore}/100</span></span>
                                  {r.signalStrength && (
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      r.signalStrength === 'BARDZO SILNY' ? 'bg-gpw-green/20 text-gpw-green' :
                                      r.signalStrength === 'SILNY'        ? 'bg-green-900/40 text-green-400' :
                                      r.signalStrength === 'UMIARKOWANY'  ? 'bg-yellow-700/30 text-yellow-400' :
                                      'bg-gpw-red/20 text-gpw-red'
                                    }`}>{r.signalStrength}</span>
                                  )}
                                </div>
                                <div className="bg-gpw-border rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${r.compositeScore >= 70 ? 'bg-gpw-green' : r.compositeScore >= 50 ? 'bg-yellow-500' : 'bg-gpw-red'}`}
                                    style={{ width: `${r.compositeScore}%` }}
                                  />
                                </div>
                              </div>
                            )}
                            <p className="text-xs text-gray-300 leading-relaxed">{r.reason}</p>
                            {r.modification && (
                              <div className="border-t border-gpw-border pt-2">
                                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">📋 Plan działania</p>
                                <p className="text-sm text-white leading-relaxed">{r.modification}</p>
                              </div>
                            )}
                            {r.longTermPerspective && (
                              <div className="border-t border-gpw-border pt-2">
                                <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">🕰️ Perspektywa 6-12 mies.</p>
                                <p className="text-xs text-gray-400 italic leading-relaxed">{r.longTermPerspective}</p>
                              </div>
                            )}
                            <div className="flex gap-2 border-t border-gpw-border pt-2">
                              <button
                                onClick={async () => {
                                  const ICON = { 'TRZYMAJ': '✅', 'ZAMKNIJ': '⛔', 'ZMODYFIKUJ': '⚙️' }
                                  const curr = (pos.exchange ?? 'GPW') === 'NYSE' ? 'USD' : 'PLN'
                                  const lines = [
                                    `📊 ${pos.tickerDisplay ?? pos.ticker} · ${pos.strategy?.toUpperCase()}`,
                                    `${ICON[r.action] ?? '📊'} ${r.action} | Siła: ${r.compositeScore ?? '—'}/100 | Pewność: ${r.confidence}%`,
                                    r.suggestedTargetPct ? `Cel AI: +${r.suggestedTargetPct}% ${curr}` : null,
                                    r.reason ? r.reason.slice(0, 120) + (r.reason.length > 120 ? '…' : '') : null,
                                    '— GPW Analyzer (analiza edukacyjna)',
                                  ].filter(Boolean).join('\n')
                                  try {
                                    if (navigator.share) {
                                      await navigator.share({ title: `GPW Analyzer — ${pos.tickerDisplay ?? pos.ticker}`, text: lines })
                                    } else {
                                      await navigator.clipboard.writeText(lines)
                                      setCopiedEval(s => ({ ...s, [pos.id]: true }))
                                      setTimeout(() => setCopiedEval(s => ({ ...s, [pos.id]: false })), 2000)
                                    }
                                  } catch { /* user cancelled */ }
                                }}
                                className="flex-1 text-xs text-gray-400 hover:text-white bg-gpw-card hover:bg-gpw-border border border-gpw-border py-1.5 rounded transition-colors"
                              >
                                {copiedEval[pos.id] ? '✅ Skopiowano!' : '🔗 Udostępnij'}
                              </button>
                              <button
                                onClick={() => setAiEvals(prev => ({ ...prev, [pos.id]: undefined }))}
                                className="flex-1 text-xs text-gray-500 hover:text-gray-300 py-1.5 transition-colors"
                              >
                                🔄 Odśwież ocenę
                              </button>
                            </div>
                          </div>
                        )
                      })()}
                      <button
                        onClick={() => setClosing(pos)}
                        className="w-full border border-gpw-border hover:border-gray-500 text-gray-300 py-2 rounded-lg text-sm transition-colors"
                      >
                        Zamknij pozycję
                      </button>
                    </div>
                  )
                })()}

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
