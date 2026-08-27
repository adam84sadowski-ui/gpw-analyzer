import { useState, useEffect, useCallback } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'
import { HORIZON, interpretPositionState } from '../../lib/interpretSignal.js'
import TechnicalPanel from '../TechnicalPanel.jsx'

function pct(v)          { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` }
function fmtCur(v, curr) { return `${v >= 0 ? '+' : ''}${v.toFixed(2)} ${curr}` }

function buildPositionShareText(pos, r, cur) {
  const ICON = { 'TRZYMAJ': '✅', 'ZAMKNIJ': '⛔', 'ZMODYFIKUJ': '⚙️' }
  const curr = (pos.exchange ?? 'GPW') === 'NYSE' ? 'USD' : 'PLN'
  const lines = []

  lines.push(`📊 ${pos.tickerDisplay ?? pos.ticker} · ${pos.strategy?.toUpperCase()}`)
  lines.push(`${ICON[r.action] ?? '📊'} ${r.action} | Siła tezy: ${r.compositeScore ?? '—'}/100 | Pewność: ${r.confidence}% | Pilność: ${r.urgency}`)
  if (r.signalStrength) lines.push(`Siła sygnału: ${r.signalStrength}`)
  if (r.suggestedTargetPct   != null) lines.push(`Cel AI: +${r.suggestedTargetPct}% ${curr}`)
  if (r.suggestedStopLossPct != null) lines.push(`Stop AI: -${r.suggestedStopLossPct}% ${curr} (rozszerzony — silne fundamenty)`)
  if (r.suggestedAddSizePct  != null) lines.push(`Sugestia AI: dołóż ${r.suggestedAddSizePct}% oryginalnej pozycji`)
  lines.push('')

  // Technical indicators from indics
  if (cur) {
    lines.push('📈 WSKAŹNIKI TECHNICZNE (aktualne):')
    if (cur.rsi != null) {
      const rsiI = cur.rsi >= 70 ? 'wykupiony' : cur.rsi <= 30 ? 'wyprzedany' : cur.rsi >= 60 ? 'silny' : cur.rsi <= 40 ? 'słaby' : 'neutralny'
      lines.push(`RSI(14): ${cur.rsi.toFixed(1)} — ${rsiI}`)
    }
    if (cur.macd?.trend) {
      const macdI = cur.macd.trend === 'bullish' ? 'byczy' : cur.macd.trend === 'bearish' ? 'niedźwiedzi' : 'neutralny'
      lines.push(`MACD: ${macdI}${cur.macd.histogram != null ? ` (hist: ${cur.macd.histogram.toFixed(3)})` : ''}`)
    }
    if (cur.bollinger?.status) {
      const bbI = { above_upper: 'powyżej górnej wstęgi', below_lower: 'poniżej dolnej wstęgi', consolidation: 'konsolidacja' }[cur.bollinger.status] ?? 'środek kanału'
      lines.push(`Bollinger: ${bbI}${cur.bollingerScore != null ? ` | Score: ${cur.bollingerScore}/100` : ''}`)
    }
    const smaParts = []
    if (cur.sma20  != null) smaParts.push(`SMA20: ${cur.sma20.toFixed(2)}`)
    if (cur.sma50  != null) smaParts.push(`SMA50: ${cur.sma50.toFixed(2)}`)
    if (cur.sma150 != null) smaParts.push(`SMA150: ${cur.sma150.toFixed(2)} ${cur.sma150trend === 'above' ? '✅' : '⚠️'}`)
    if (smaParts.length) lines.push(smaParts.join(' | '))
    if (cur.volMult != null) {
      const volI = cur.volMult >= 2.5 ? 'bardzo wysoki' : cur.volMult >= 1.5 ? 'wysoki' : cur.volMult >= 1 ? 'normalny' : 'niski'
      lines.push(`Wolumen: ${cur.volMult}x — ${volI}`)
    }
    if (cur.atrPct != null) {
      const atrI = cur.atrPct > 3 ? 'wysoka zmienność' : cur.atrPct > 1.5 ? 'umiarkowana' : 'niska zmienność'
      lines.push(`ATR: ${cur.atrPct}% — ${atrI}`)
    }
    if (cur.nearSupport != null) lines.push(`Wsparcie: ${cur.nearSupport} ${curr}`)
    if (cur.divergence === 'bullish') lines.push('Dywergencja RSI: 🟢 bycza')
    if (cur.divergence === 'bearish') lines.push('Dywergencja RSI: 🔴 niedźwiedzia')
    if (cur.indexTrend) {
      const idxI = { up: 'wzrostowy', down: 'spadkowy', neutral: 'neutralny' }[cur.indexTrend] ?? cur.indexTrend
      lines.push(`Indeks rynkowy: ${idxI}`)
    }
    if (cur.score != null) lines.push(`Score techniczny: ${cur.score}/100`)
    lines.push('')
  }

  if (r.reason) { lines.push('💬 OCENA AI:'); lines.push(r.reason); lines.push('') }
  if (r.modification) { lines.push('📋 PLAN DZIAŁANIA:'); lines.push(r.modification); lines.push('') }
  if (r.longTermPerspective) { lines.push('🕰️ PERSPEKTYWA 6-12 MIES.:'); lines.push(r.longTermPerspective); lines.push('') }

  lines.push('— GPW Analyzer (analiza edukacyjna)')
  return lines.join('\n')
}

const HOLD_HORIZON = { scalping: 5, swing: 40, aggressive: 30 }

function computeHoldStrength(pos, cp, cur, aiEval) {
  const ep       = pos.avgEntryPrice ?? pos.entryPrice
  const pnlPct   = cp ? ((cp - ep) / ep * 100) : null
  const today    = new Date(new Date().toISOString().slice(0, 10))
  const daysHeld = Math.max(0, Math.round((today - new Date(pos.entryDate.slice(0, 10))) / 86400000))
  const horizon  = HOLD_HORIZON[pos.strategy] ?? 30

  // 1. Efficiency (30%) — pnl pace vs horizon pace
  let efficiency = 50
  if (pnlPct != null && pos.target && daysHeld > 0) {
    const effRatio = (pnlPct / pos.target) / (daysHeld / horizon)
    efficiency = Math.min(100, Math.max(0, Math.round(effRatio * 50)))
  }

  // 2. Momentum (25%) — RSI direction vs entry
  let momentum = 50
  const rsiNow   = cur?.rsi
  const rsiEntry = pos.entryRsi
  if (rsiNow != null && rsiEntry != null) {
    const d = rsiNow - rsiEntry
    momentum = d > 10 ? 90 : d > 4 ? 75 : d > 0 ? 60 : d < -10 ? 15 : d < -4 ? 30 : 45
  }

  // 3. Thesis integrity (25%) — signal-type specific check
  let thesis = 50
  const sma50 = cur?.sma50Delta
  if (pos.signal === 'PULLBACK_TO_SMA50' && sma50 != null) {
    thesis = sma50 >= -3 && sma50 <= 8 ? 85 : sma50 > 8 ? 70 : 30
  } else if (pos.signal === 'RSI_OVERSOLD' && rsiNow != null) {
    thesis = rsiNow >= 40 && rsiNow <= 65 ? 80 : rsiNow > 65 ? 60 : 30
  } else if (pos.signal === 'BREAKOUT' && rsiNow != null) {
    thesis = rsiNow >= 55 ? 85 : rsiNow >= 45 ? 60 : 30
  }

  // 4. Entry quality (10%)
  const entryQuality = pos.entryScore ?? 50

  // 5. AI history (10%)
  let aiHistory = 50
  if (aiEval?.result) {
    const { action, confidence } = aiEval.result
    if (action === 'TRZYMAJ') aiHistory = confidence ?? 70
    else if (action === 'ZAMKNIJ') aiHistory = 100 - (confidence ?? 70)
  }

  const total = Math.round(efficiency * 0.30 + momentum * 0.25 + thesis * 0.25 + entryQuality * 0.10 + aiHistory * 0.10)
  return { total, dimensions: { efficiency, momentum, thesis, entryQuality, aiHistory } }
}

function CloseModal({ position, onClose, onConfirm, currency }) {
  const [exitPrice,   setExitPrice]   = useState(String(position.entryPrice))
  const [priceLoading, setPriceLoading] = useState(true)
  const [closePct,    setClosePct]    = useState(100)

  useEffect(() => {
    const exchange = position.exchange ?? 'GPW'
    fetch(`/api/market?mode=current&ticker=${position.ticker}&exchange=${exchange}`)
      .then(r => r.json())
      .then(d => { if (d?.close) setExitPrice(String(d.close)) })
      .catch(() => {})
      .finally(() => setPriceLoading(false))
  }, [])

  const ep          = position.avgEntryPrice ?? position.entryPrice
  const sharesToClose = Math.round(position.shares * closePct / 100)
  const pnlPct      = ((Number(exitPrice) - ep) / ep * 100).toFixed(2)
  const pnlAmt      = ((Number(exitPrice) - ep) * sharesToClose).toFixed(2)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gpw-card border border-gpw-border rounded-xl p-6 w-full max-w-sm space-y-4">
        <h3 className="font-semibold text-lg">Zamknij pozycję — {position.tickerDisplay}</h3>
        <div className="text-sm text-gray-400">Łącznie akcji: <span className="text-white">{position.shares}</span> · Wejście: <span className="text-white">{ep} {currency}</span></div>

        <div className="space-y-1.5">
          <span className="text-sm text-gray-400">Zamknij:</span>
          <div className="flex gap-2">
            {[25, 50, 75, 100].map(v => (
              <button
                key={v}
                onClick={() => setClosePct(v)}
                className={`flex-1 py-1.5 rounded text-sm font-semibold border transition-colors ${
                  closePct === v
                    ? 'bg-gpw-blue border-gpw-blue text-white'
                    : 'bg-gpw-dark border-gpw-border text-gray-400 hover:border-gray-500'
                }`}
              >
                {v}%
              </button>
            ))}
          </div>
          {closePct < 100 && (
            <p className="text-xs text-gray-500">{sharesToClose} z {position.shares} akcji</p>
          )}
        </div>

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
            onClick={() => onConfirm(Number(exitPrice), closePct)}
            className="flex-1 bg-gpw-green hover:bg-green-600 text-white py-2 rounded-lg text-sm font-semibold"
          >
            Potwierdź {closePct < 100 ? `${closePct}%` : 'zamknięcie'}
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
  const [addSizeState,  setAddSizeState]  = useState({}) // posId → { pct, price, loading, error, confirmed }
  const [paramAction,   setParamAction]   = useState({}) // posId → { target: 'confirmed'|'rejected'|null, stop: 'confirmed'|'rejected'|null }
  const [horizonEvals,  setHorizonEvals]  = useState({}) // posId → { loading, result }
  const [horizonConfirm, setHorizonConfirm] = useState({}) // posId → null|'tactical_loading'|'tactical_done'|'longterm_loading'|'longterm_done'|'upgrade_confirm'|'upgrade_loading'|'upgrade_done'

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

  async function closePosition(exitPrice, closePct = 100) {
    const id = closing.id
    if (closePct < 100) {
      const res     = await fetch('/api/positions', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, action: 'partialClose', closePct, exitPrice }),
      })
      const updated = await res.json()
      setPositions(prev => prev.map(p => p.id === id ? updated : p))
    } else {
      await fetch('/api/positions', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, exitPrice }),
      })
      localStorage.removeItem(`chat_pos_${id}`)
      setChatState(s => { const n = { ...s }; delete n[id]; return n })
    }
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
      const todayStr = new Date().toISOString().slice(0, 10)
      const today    = new Date(todayStr)
      const daysHeld = Math.round((today - entryDay) / 86400000)
      const pnlPct   = cp ? ((cp - pos.entryPrice) / pos.entryPrice * 100).toFixed(2) : 0
      // Compute hold strength to enrich AI prompt
      const ev = aiEvals[pos.id]
      const hs = computeHoldStrength(pos, cp, cur, ev)
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
        hsTotal:       hs.total,
        hsEff:         hs.dimensions.efficiency,
        hsMom:         hs.dimensions.momentum,
        hsTh:          hs.dimensions.thesis,
        hsEQ:          hs.dimensions.entryQuality,
        hsAI:          hs.dimensions.aiHistory,
      })
      const res  = await fetch(`/api/market?${params}`)
      const data = await res.json()
      setAiEvals(prev => ({ ...prev, [pos.id]: { loading: false, result: data } }))
      // Only auto-save suggestedAddSizePct (metadata for confirm form) — target and stopLoss require explicit user confirmation
      if (data.suggestedAddSizePct != null) {
        fetch('/api/positions', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: pos.id, suggestedAddSizePct: data.suggestedAddSizePct }),
        }).catch(() => {})
        setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, suggestedAddSizePct: data.suggestedAddSizePct }))
      }
      // Dynamic nextReviewDate = min(claude_date, hs_date)
      const addDays = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10) }
      const hsDays = hs.total >= 75 ? 7 : hs.total >= 50 ? 3 : 1
      const hsDate = addDays(todayStr, hsDays)
      const finalReviewDate = data.nextReviewDate
        ? (data.nextReviewDate < hsDate ? data.nextReviewDate : hsDate)
        : hsDate
      fetch('/api/positions', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: pos.id, nextReviewDate: finalReviewDate }),
      }).catch(() => {})
      setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, nextReviewDate: finalReviewDate }))
      // Save AI eval history entry for trajectory tracking
      const historyEntry = {
        date:           todayStr,
        holdTotal:      hs.total,
        holdDimensions: hs.dimensions,
        aiAction:       data.action,
        aiConfidence:   data.confidence,
      }
      fetch('/api/positions', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: pos.id, action: 'saveEvalHistory', historyEntry }),
      }).then(r => r.json()).then(updated => {
        if (updated.aiEvalHistory) {
          setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, aiEvalHistory: updated.aiEvalHistory }))
        }
      }).catch(() => {})
      // Reset param action state so confirm/reject UI shows fresh for new eval
      setParamAction(s => ({ ...s, [pos.id]: { target: null, stop: null } }))
    } catch {
      setAiEvals(prev => ({ ...prev, [pos.id]: { loading: false, result: null } }))
    }
  }

  async function evaluateHorizonFn(pos) {
    const cp = prices[pos.ticker]
    const entryDay = new Date(pos.entryDate.slice(0, 10))
    const today    = new Date(new Date().toISOString().slice(0, 10))
    const daysHeld = Math.round((today - entryDay) / 86400000)
    const pnlPct   = cp ? ((cp - pos.entryPrice) / pos.entryPrice * 100).toFixed(2) : 0
    setHorizonEvals(prev => ({ ...prev, [pos.id]: { loading: true, result: null } }))
    try {
      const params = new URLSearchParams({
        mode:         'horizon-evaluate',
        ticker:       pos.ticker,
        exchange:     pos.exchange ?? 'GPW',
        posId:        pos.id,
        strategy:     pos.strategy ?? 'swing',
        currentPrice: cp ?? pos.entryPrice,
        pnlPct,
        daysHeld,
      })
      const res  = await fetch(`/api/market?${params}`)
      const data = await res.json()
      setHorizonEvals(prev => ({ ...prev, [pos.id]: { loading: false, result: data } }))
    } catch {
      setHorizonEvals(prev => ({ ...prev, [pos.id]: { loading: false, result: null } }))
    }
  }

  async function confirmHorizonOption(pos, optType, opts) {
    setHorizonConfirm(s => ({ ...s, [pos.id]: optType + '_loading' }))
    try {
      const body = { id: pos.id }
      if (opts.target        != null) body.target        = opts.target
      if (opts.stopLoss      != null) body.stopLoss      = opts.stopLoss
      if (opts.strategy      != null) body.strategy      = opts.strategy
      if (opts.nextReviewDate)        body.nextReviewDate = opts.nextReviewDate
      const res     = await fetch('/api/positions', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const updated = await res.json()
      setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, ...updated }))
      setHorizonConfirm(s => ({ ...s, [pos.id]: optType + '_done' }))
    } catch {
      setHorizonConfirm(s => ({ ...s, [pos.id]: null }))
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
          {tab === 'open' && openPositions.length > 0 && (() => {
            const today = new Date(new Date().toISOString().slice(0, 10))
            const withReview = openPositions
              .map(pos => {
                if (!pos.nextReviewDate) return null
                const diffDays = Math.round((new Date(pos.nextReviewDate) - today) / 86400000)
                if (diffDays > 7) return null
                return { pos, diffDays }
              })
              .filter(Boolean)
              .sort((a, b) => a.diffDays - b.diffDays)

            return (
              <div className="bg-gpw-card border border-gpw-border rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">📋 Kolejka przeglądów</p>
                {withReview.length === 0 ? (
                  <p className="text-xs text-gray-500">✅ Brak zaplanowanych przeglądów w ciągu 7 dni</p>
                ) : withReview.map(({ pos, diffDays }) => {
                  const cp          = prices[pos.ticker]
                  const effectiveEP = pos.avgEntryPrice ?? pos.entryPrice
                  const positionPnl = cp ? ((cp - effectiveEP) / effectiveEP * 100) : null
                  const ev          = aiEvals[pos.id]
                  let badge, badgeCls, needsReview
                  if (diffDays < 0) {
                    badge = `PRZETERMINOWANA (${Math.abs(diffDays)}d)`
                    badgeCls = 'text-red-400 bg-red-900/20 border border-red-800'
                    needsReview = true
                  } else if (diffDays === 0) {
                    badge = 'DZIŚ'
                    badgeCls = 'text-orange-400 bg-orange-900/20 border border-orange-800'
                    needsReview = true
                  } else if (diffDays === 1) {
                    badge = 'JUTRO'
                    badgeCls = 'text-yellow-400 bg-yellow-900/10'
                    needsReview = false
                  } else {
                    badge = `za ${diffDays} dni`
                    badgeCls = 'text-gray-500 bg-gpw-dark'
                    needsReview = false
                  }
                  return (
                    <div key={pos.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gpw-border/50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-semibold text-sm">{pos.tickerDisplay ?? pos.ticker}</span>
                        <span className="text-[10px] text-gray-500 shrink-0">{pos.strategy}</span>
                        {positionPnl != null && (
                          <span className={`text-xs font-bold shrink-0 ${positionPnl >= 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                            {positionPnl >= 0 ? '+' : ''}{positionPnl.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeCls}`}>{badge}</span>
                        {needsReview && (
                          <button
                            onClick={() => evaluateWithAI(pos)}
                            disabled={ev?.loading}
                            className="text-[10px] bg-gpw-blue hover:bg-blue-600 disabled:opacity-50 text-white px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                          >
                            {ev?.loading ? '…' : '🤖 Waliduj AI'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {positions.map(pos => {
            const cur          = posCurrency(pos)
            const cp           = prices[pos.ticker]
            const effectiveEP  = pos.avgEntryPrice ?? pos.entryPrice
            const pnlPct       = cp ? ((cp - effectiveEP) / effectiveEP * 100) : null
            const pnlAmt       = cp ? ((cp - effectiveEP) * pos.shares) : null

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

                {/* Soft exit warning banner */}
                {pos.status === 'open' && pos.aiEvalHistory?.length >= 2 && pos.aiEvalHistory.slice(-2).every(e => e.holdTotal < 25) && (
                  <div className="bg-gpw-red/15 border border-gpw-red/50 rounded-lg px-3 py-2 text-xs space-y-0.5">
                    <p className="text-gpw-red font-bold">⚠️ SOFT EXIT — słabnąca teza</p>
                    <p className="text-gray-300">
                      Dwa kolejne przeglądy AI wykazały Hold Strength poniżej 25/100
                      {' '}({pos.aiEvalHistory.slice(-2).map(e => e.holdTotal).join(' → ')}).
                      Rozważ zamknięcie pozycji.
                    </p>
                  </div>
                )}

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

                {pos.avgEntryPrice != null && Math.abs(pos.avgEntryPrice - pos.entryPrice) > 0.001 && (
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span>Śr. cena wejścia: <span className="text-blue-300 font-semibold">{pos.avgEntryPrice} {cur}</span></span>
                    {pos.addedPositions?.length > 0 && (
                      <span className="bg-blue-900/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px]">zwiększono {pos.addedPositions.length}×</span>
                    )}
                  </div>
                )}

                {pos.partialCloses?.length > 0 && (
                  <div className="text-xs text-gray-500 space-y-0.5">
                    {pos.partialCloses.map((pc, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="bg-yellow-900/20 text-yellow-400 px-1.5 py-0.5 rounded text-[10px]">📤 {pc.closePct}% zamknięte</span>
                        <span>{pc.closedShares} akcji @ {pc.exitPrice} {cur}</span>
                        <span className={pc.pnlPct >= 0 ? 'text-gpw-green' : 'text-gpw-red'}>{pc.pnlPct >= 0 ? '+' : ''}{pc.pnlPct}%</span>
                        <span className="text-gray-600">({pc.date})</span>
                      </div>
                    ))}
                  </div>
                )}

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
                        : <><span className="text-gpw-red">-{pos.stopLoss}%</span>
                           {aiEvals[pos.id]?.result?.suggestedStopLossPct != null && <span className="text-[10px] text-gpw-blue ml-0.5">🤖</span>}
                           <span className="text-gray-400 ml-1">({(pos.entryPrice * (1 - pos.stopLoss / 100)).toFixed(2)} {cur})</span></>
                      }
                    </div>
                    {aiEvals[pos.id]?.result?.suggestedAddSizePct != null && (
                      <div className="flex-1 text-center bg-green-900/20 rounded p-1.5">
                        🔼 Dokładaj: <span className="text-green-400">+{aiEvals[pos.id].result.suggestedAddSizePct}%</span>
                      </div>
                    )}
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

                {/* ── Hold Strength ── */}
                {pos.status === 'open' && (() => {
                  const cp  = prices[pos.ticker]
                  const cur = indics[pos.id]
                  const ev  = aiEvals[pos.id]
                  if (!cp && !cur) return null
                  const hs       = computeHoldStrength(pos, cp, cur, ev)
                  const barCls   = hs.total >= 70 ? 'bg-gpw-green' : hs.total >= 40 ? 'bg-yellow-500' : 'bg-gpw-red'
                  const textCls  = hs.total >= 70 ? 'text-gpw-green' : hs.total >= 40 ? 'text-yellow-400' : 'text-gpw-red'
                  const dimCls   = v => v >= 70 ? 'text-gpw-green' : v >= 40 ? 'text-yellow-400' : 'text-gpw-red'
                  return (
                    <div className="border-t border-gpw-border pt-2 space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">🏋️ Hold Strength</span>
                        <span className={`font-bold text-sm ${textCls}`}>{hs.total}/100</span>
                      </div>
                      <div className="w-full bg-gpw-dark rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${barCls}`} style={{ width: `${hs.total}%` }} />
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-[9px] text-center text-gray-500">
                        {[
                          ['Efektyw.', hs.dimensions.efficiency],
                          ['Momentum', hs.dimensions.momentum],
                          ['Teza', hs.dimensions.thesis],
                          ['Wejście', hs.dimensions.entryQuality],
                          ['AI', hs.dimensions.aiHistory],
                        ].map(([label, val]) => (
                          <div key={label}>
                            <div className={`font-semibold ${dimCls(val)}`}>{val}</div>
                            <div>{label}</div>
                          </div>
                        ))}
                      </div>
                      {pos.aiEvalHistory?.length > 1 && (
                        <div className="text-[9px] text-gray-500 flex items-center gap-1 flex-wrap pt-0.5">
                          <span className="text-gray-600">Trajektoria:</span>
                          {pos.aiEvalHistory.slice(-5).map((e, i, arr) => (
                            <span key={i} className={e.holdTotal >= 70 ? 'text-gpw-green' : e.holdTotal >= 40 ? 'text-yellow-400' : 'text-gpw-red'}>
                              {e.holdTotal}{i < arr.length - 1 ? ' →' : ''}
                            </span>
                          ))}
                          {pos.aiEvalHistory.slice(-2).every(e => e.holdTotal < 25) && (
                            <span className="text-gpw-red font-semibold ml-1">⚠️ SOFT EXIT</span>
                          )}
                        </div>
                      )}
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

                {/* ── Co dalej z pozycją? (horizon review) ── */}
                {pos.status === 'open' && (() => {
                  const entryDay     = new Date(pos.entryDate.slice(0, 10))
                  const today        = new Date(new Date().toISOString().slice(0, 10))
                  const daysHeld     = Math.round((today - entryDay) / 86400000)
                  const horizon      = HOLD_HORIZON[pos.strategy] ?? 30
                  const triggered    = pos.strategy === 'scalping' ? daysHeld >= 3 : daysHeld >= Math.round(horizon * 0.8)
                  if (!triggered) return null
                  const he   = horizonEvals[pos.id]
                  const hc   = horizonConfirm[pos.id]
                  const r    = he?.result
                  const optClr = { blue: 'border-gpw-blue/40 bg-gpw-blue/5', purple: 'border-purple-600/40 bg-purple-900/10', orange: 'border-orange-600/40 bg-orange-900/10' }
                  const btnClr = { blue: 'bg-gpw-blue/20 hover:bg-gpw-blue/30 border-gpw-blue/40 text-blue-300', purple: 'bg-purple-800/20 hover:bg-purple-800/30 border-purple-700/40 text-purple-300', orange: 'bg-orange-800/20 hover:bg-orange-800/30 border-orange-700/40 text-orange-300' }
                  return (
                    <div className="border-t border-yellow-700/40 pt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-yellow-400 font-semibold">⏱ Co dalej z pozycją?</span>
                        {!r && (
                          <button
                            onClick={() => evaluateHorizonFn(pos)}
                            disabled={he?.loading}
                            className="text-xs bg-yellow-700/20 hover:bg-yellow-700/30 border border-yellow-700/40 text-yellow-300 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                          >
                            {he?.loading ? 'Analizuję…' : 'Analizuj opcje'}
                          </button>
                        )}
                        {r && (
                          <button onClick={() => setHorizonEvals(prev => ({ ...prev, [pos.id]: null }))} className="text-[10px] text-gray-600 hover:text-gray-400">✕</button>
                        )}
                      </div>
                      {r && (
                        <div className="space-y-2 text-xs">
                          {/* Opcja 1: Przedłuż taktycznie */}
                          {r.tacticalOption && (
                            <div className={`border rounded-lg p-2.5 space-y-1.5 ${optClr.blue}`}>
                              <p className="font-semibold text-blue-300">📈 Opcja 1: Przedłuż o {r.tacticalOption.weeks ?? '?'} tygodni (ta sama strategia)</p>
                              <p className="text-gray-400 leading-relaxed">{r.tacticalOption.rationale}</p>
                              <div className="flex flex-wrap gap-2 text-[10px] text-gray-500">
                                {r.tacticalOption.newTarget && <span>Cel: <span className="text-white">+{r.tacticalOption.newTarget}%</span></span>}
                                {r.tacticalOption.checkpoint && <span>Przegląd: <span className="text-white">{r.tacticalOption.checkpoint}</span></span>}
                              </div>
                              {hc === 'tactical_done'
                                ? <p className="text-gpw-green text-[10px]">✅ Zapisano — checkpoint i cel zaktualizowane</p>
                                : (
                                  <button
                                    onClick={() => confirmHorizonOption(pos, 'tactical', { target: r.tacticalOption.newTarget, nextReviewDate: r.tacticalOption.checkpoint })}
                                    disabled={hc === 'tactical_loading'}
                                    className={`text-[10px] border px-2 py-0.5 rounded transition-colors disabled:opacity-50 ${btnClr.blue}`}
                                  >
                                    {hc === 'tactical_loading' ? 'Zapisuję…' : 'Potwierdź'}
                                  </button>
                                )
                              }
                            </div>
                          )}
                          {/* Opcja 2: Długoterminowe */}
                          {r.longTermOption?.applicable
                            ? (
                              <div className={`border rounded-lg p-2.5 space-y-1.5 ${optClr.purple}`}>
                                <p className="font-semibold text-purple-300">🕰️ Opcja 2: Długoterminowo ({r.longTermOption.months ?? '?'} mcy)</p>
                                <p className="text-gray-400 leading-relaxed">{r.longTermOption.rationale}</p>
                                <div className="flex flex-wrap gap-2 text-[10px] text-gray-500">
                                  {r.longTermOption.newTarget && <span>Cel: <span className="text-white">+{r.longTermOption.newTarget}%</span></span>}
                                  {r.longTermOption.nextCheckpoint && <span>Przegląd za 30 dni: <span className="text-white">{r.longTermOption.nextCheckpoint}</span></span>}
                                </div>
                                {hc === 'longterm_done'
                                  ? <p className="text-gpw-green text-[10px]">✅ Zapisano — strategia zmieniona na długoterminową</p>
                                  : (
                                    <button
                                      onClick={() => confirmHorizonOption(pos, 'longterm', { strategy: 'long_term', target: r.longTermOption.newTarget, nextReviewDate: r.longTermOption.nextCheckpoint })}
                                      disabled={hc === 'longterm_loading'}
                                      className={`text-[10px] border px-2 py-0.5 rounded transition-colors disabled:opacity-50 ${btnClr.purple}`}
                                    >
                                      {hc === 'longterm_loading' ? 'Zapisuję…' : 'Potwierdź'}
                                    </button>
                                  )
                                }
                              </div>
                            )
                            : (
                              <div className="border border-gray-700/40 rounded-lg p-2.5 space-y-1">
                                <p className="text-gray-500 text-[10px]">🕰️ Opcja 2: Długoterminowe — <span className="italic">nieaplikowane</span></p>
                                <p className="text-gray-600 leading-relaxed">{r.longTermOption?.rationale}</p>
                              </div>
                            )
                          }
                          {/* Opcja 3: Upgrade strategii */}
                          {r.strategyUpgradeOption?.applicable
                            ? (
                              <div className={`border rounded-lg p-2.5 space-y-1.5 ${optClr.orange}`}>
                                <p className="font-semibold text-orange-300">🚀 Opcja 3: Upgrade → {r.strategyUpgradeOption.upgradeTo}</p>
                                <p className="text-gray-400 leading-relaxed">{r.strategyUpgradeOption.rationale}</p>
                                <div className="flex flex-wrap gap-2 text-[10px] text-gray-500">
                                  {r.strategyUpgradeOption.newTarget && <span>Nowy cel: <span className="text-white">+{r.strategyUpgradeOption.newTarget}%</span></span>}
                                  {r.strategyUpgradeOption.newStopLoss && <span>Nowy stop: <span className="text-white">-{r.strategyUpgradeOption.newStopLoss}%</span></span>}
                                  {r.strategyUpgradeOption.checkpoint && <span>Przegląd: <span className="text-white">{r.strategyUpgradeOption.checkpoint}</span></span>}
                                </div>
                                {hc === 'upgrade_done'
                                  ? <p className="text-gpw-green text-[10px]">✅ Zapisano — strategia zmieniona na {r.strategyUpgradeOption.upgradeTo}</p>
                                  : hc === 'upgrade_confirm'
                                  ? (
                                    <div className="space-y-1">
                                      <p className="text-yellow-400 text-[10px]">⚠️ Zmiana strategii zmienia cel i stop loss. Czy na pewno?</p>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => confirmHorizonOption(pos, 'upgrade', { strategy: r.strategyUpgradeOption.upgradeTo, target: r.strategyUpgradeOption.newTarget, stopLoss: r.strategyUpgradeOption.newStopLoss, nextReviewDate: r.strategyUpgradeOption.checkpoint })}
                                          className={`text-[10px] border px-2 py-0.5 rounded transition-colors ${btnClr.orange}`}
                                        >
                                          Tak, zmień strategię
                                        </button>
                                        <button onClick={() => setHorizonConfirm(s => ({ ...s, [pos.id]: null }))} className="text-[10px] text-gray-500 hover:text-gray-300">Anuluj</button>
                                      </div>
                                    </div>
                                  )
                                  : (
                                    <button
                                      onClick={() => setHorizonConfirm(s => ({ ...s, [pos.id]: 'upgrade_confirm' }))}
                                      disabled={hc === 'upgrade_loading'}
                                      className={`text-[10px] border px-2 py-0.5 rounded transition-colors disabled:opacity-50 ${btnClr.orange}`}
                                    >
                                      {hc === 'upgrade_loading' ? 'Zapisuję…' : 'Potwierdź'}
                                    </button>
                                  )
                                }
                              </div>
                            )
                            : (
                              <div className="border border-gray-700/40 rounded-lg p-2.5 space-y-1">
                                <p className="text-gray-500 text-[10px]">🚀 Opcja 3: Upgrade strategii — <span className="italic">nieaplikowany</span></p>
                                <p className="text-gray-600 leading-relaxed">{r.strategyUpgradeOption?.rationale}</p>
                              </div>
                            )
                          }
                        </div>
                      )}
                    </div>
                  )
                })()}

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
                                {r.suggestedStopLossPct != null && paramAction[pos.id]?.stop == null && (
                                  <span className="text-[10px] bg-gpw-blue/20 text-gpw-blue px-1.5 py-0.5 rounded font-semibold animate-pulse">
                                    🤖 Stop −{r.suggestedStopLossPct}% ↓
                                  </span>
                                )}
                                {r.suggestedAddSizePct != null && (
                                  <span className="text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded font-semibold">
                                    🔼 +{r.suggestedAddSizePct}%
                                  </span>
                                )}
                                {r.nextReviewDate && (
                                  <span className="text-[10px] bg-gpw-dark text-gray-400 px-1.5 py-0.5 rounded">
                                    📅 {r.nextReviewDate}
                                  </span>
                                )}
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
                            {r.suggestedTargetPct != null && (() => {
                              const pa = paramAction[pos.id]?.target
                              return (
                                <div className="border-t border-gpw-border pt-2 space-y-1.5">
                                  <p className="text-[10px] text-gpw-blue font-semibold uppercase tracking-wide">🎯 Sugestia zmiany celu</p>
                                  {pa === 'confirmed' ? (
                                    <p className="text-xs text-gpw-green">✅ Cel zaktualizowany do +{r.suggestedTargetPct}%</p>
                                  ) : pa === 'rejected' ? (
                                    <p className="text-xs text-gray-500 italic">❌ Odrzucono — AI nie zaproponuje ponownie</p>
                                  ) : (
                                    <>
                                      <p className="text-xs text-gray-300">
                                        <span className="text-gray-500">Obecny cel:</span> <span className="line-through text-gray-500">+{pos.target}%</span>
                                        {' → '}
                                        <span className="text-gpw-blue font-bold">+{r.suggestedTargetPct}%</span>
                                      </p>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={async () => {
                                            await fetch('/api/positions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pos.id, target: r.suggestedTargetPct }) }).catch(() => {})
                                            setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, target: r.suggestedTargetPct }))
                                            setParamAction(s => ({ ...s, [pos.id]: { ...s[pos.id], target: 'confirmed' } }))
                                          }}
                                          className="flex-1 bg-gpw-blue hover:bg-blue-600 text-white py-1.5 rounded text-xs font-semibold transition-colors"
                                        >
                                          ✅ Potwierdź +{r.suggestedTargetPct}%
                                        </button>
                                        <button
                                          onClick={async () => {
                                            const rejection = { value: r.suggestedTargetPct, date: new Date().toISOString().slice(0, 10) }
                                            await fetch('/api/positions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pos.id, aiTargetRejected: rejection }) }).catch(() => {})
                                            setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, aiTargetRejected: rejection }))
                                            setParamAction(s => ({ ...s, [pos.id]: { ...s[pos.id], target: 'rejected' } }))
                                          }}
                                          className="flex-1 border border-gpw-border hover:border-gray-500 text-gray-400 hover:text-white py-1.5 rounded text-xs transition-colors"
                                        >
                                          ❌ Odrzuć
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            })()}
                            {r.suggestedStopLossPct != null && (() => {
                              const pa = paramAction[pos.id]?.stop
                              return (
                                <div className="border-t border-gpw-border pt-2 space-y-1.5">
                                  <p className="text-[10px] text-gpw-blue font-semibold uppercase tracking-wide">🛑 Sugestia zmiany stop loss</p>
                                  {pa === 'confirmed' ? (
                                    <p className="text-xs text-gpw-green">✅ Stop loss zaktualizowany do -{r.suggestedStopLossPct}%</p>
                                  ) : pa === 'rejected' ? (
                                    <p className="text-xs text-gray-500 italic">❌ Odrzucono — AI nie zaproponuje ponownie</p>
                                  ) : (
                                    <>
                                      <p className="text-xs text-gray-300">
                                        <span className="text-gray-500">Obecny stop:</span> <span className="line-through text-gray-500">-{pos.stopLoss}%</span>
                                        {' → '}
                                        <span className="text-gpw-blue font-bold">-{r.suggestedStopLossPct}%</span>
                                      </p>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={async () => {
                                            await fetch('/api/positions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pos.id, stopLoss: r.suggestedStopLossPct }) }).catch(() => {})
                                            setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, stopLoss: r.suggestedStopLossPct }))
                                            setParamAction(s => ({ ...s, [pos.id]: { ...s[pos.id], stop: 'confirmed' } }))
                                          }}
                                          className="flex-1 bg-gpw-blue hover:bg-blue-600 text-white py-1.5 rounded text-xs font-semibold transition-colors"
                                        >
                                          ✅ Potwierdź -{r.suggestedStopLossPct}%
                                        </button>
                                        <button
                                          onClick={async () => {
                                            const rejection = { value: r.suggestedStopLossPct, date: new Date().toISOString().slice(0, 10) }
                                            await fetch('/api/positions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pos.id, aiStopRejected: rejection }) }).catch(() => {})
                                            setPositions(prev => prev.map(p => p.id !== pos.id ? p : { ...p, aiStopRejected: rejection }))
                                            setParamAction(s => ({ ...s, [pos.id]: { ...s[pos.id], stop: 'rejected' } }))
                                          }}
                                          className="flex-1 border border-gpw-border hover:border-gray-500 text-gray-400 hover:text-white py-1.5 rounded text-xs transition-colors"
                                        >
                                          ❌ Odrzuć
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            })()}
                            {r.longTermPerspective && (
                              <div className="border-t border-gpw-border pt-2">
                                <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1">🕰️ Perspektywa 6-12 mies.</p>
                                <p className="text-xs text-gray-400 italic leading-relaxed">{r.longTermPerspective}</p>
                              </div>
                            )}
                            {(r.bullCase || r.bearCase) && (
                              <div className="border-t border-gpw-border pt-2 space-y-1.5">
                                {r.bullCase && (
                                  <div className="flex gap-2 items-start">
                                    <span className="text-gpw-green text-[11px] font-bold shrink-0">🟢 Bull:</span>
                                    <p className="text-xs text-gray-300 leading-relaxed">{r.bullCase}</p>
                                  </div>
                                )}
                                {r.bearCase && (
                                  <div className="flex gap-2 items-start">
                                    <span className="text-gpw-red text-[11px] font-bold shrink-0">🔴 Bear:</span>
                                    <p className="text-xs text-gray-300 leading-relaxed">{r.bearCase}</p>
                                  </div>
                                )}
                              </div>
                            )}
                            {r.addSizeExplanation != null && (() => {
                              const hasSuggestion = r.suggestedAddSizePct != null
                              const addSt = addSizeState[pos.id] ?? {}
                              const currentPct   = addSt.pct   ?? r.suggestedAddSizePct ?? 25
                              const currentPrice = addSt.price ?? String(prices[pos.ticker] ?? pos.entryPrice)
                              return (
                                <div className="border-t border-gpw-border pt-2 space-y-2">
                                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${hasSuggestion ? 'text-green-400' : 'text-gray-500'}`}>
                                    🔼 Zwiększenie pozycji
                                  </p>
                                  {hasSuggestion ? (
                                    addSt.confirmed ? (
                                      <p className="text-xs text-green-400">✅ Zwiększenie potwierdzone! Śr. cena wejścia zaktualizowana.</p>
                                    ) : (
                                      <>
                                        <p className="text-xs text-gray-400 leading-relaxed">{r.addSizeExplanation}</p>
                                        <div className="flex gap-2 items-center">
                                          <div className="flex gap-1">
                                            {[25, 50, 100].map(v => (
                                              <button
                                                key={v}
                                                onClick={() => setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], pct: v } }))}
                                                className={`text-xs px-2 py-1 rounded border transition-colors ${currentPct === v ? 'bg-green-900/40 border-green-600 text-green-400 font-bold' : 'border-gpw-border text-gray-400 hover:border-gray-500'}`}
                                              >
                                                +{v}%
                                              </button>
                                            ))}
                                          </div>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={currentPrice}
                                            onChange={e => setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], price: e.target.value } }))}
                                            className="w-24 bg-gpw-dark border border-gpw-border rounded px-2 py-1 text-xs text-white outline-none focus:border-gpw-blue"
                                            placeholder={`Cena (${cur})`}
                                          />
                                        </div>
                                        {addSt.error && <p className="text-xs text-gpw-red">{addSt.error}</p>}
                                        <button
                                          disabled={addSt.loading}
                                          onClick={async () => {
                                            const pct  = currentPct
                                            const price = Number(currentPrice)
                                            if (!price || price <= 0) {
                                              setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], error: 'Podaj prawidłową cenę' } }))
                                              return
                                            }
                                            setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], loading: true, error: null } }))
                                            try {
                                              const res = await fetch('/api/positions', {
                                                method: 'PATCH',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ id: pos.id, action: 'addToPosition', addedPct: pct, priceAtAdd: price }),
                                              })
                                              if (!res.ok) {
                                                const err = await res.json().catch(() => ({}))
                                                setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], loading: false, error: err.error ?? 'Błąd' } }))
                                                return
                                              }
                                              const updated = await res.json()
                                              setPositions(prev => prev.map(p => p.id === pos.id ? updated : p))
                                              setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], loading: false, confirmed: true } }))
                                            } catch {
                                              setAddSizeState(s => ({ ...s, [pos.id]: { ...s[pos.id], loading: false, error: 'Błąd sieci' } }))
                                            }
                                          }}
                                          className="w-full bg-green-800 hover:bg-green-700 disabled:opacity-50 text-white py-1.5 rounded text-xs font-semibold transition-colors"
                                        >
                                          {addSt.loading ? 'Zapisuję…' : `✅ Potwierdź: dołóż +${currentPct}% pozycji @ ${currentPrice} ${cur}`}
                                        </button>
                                      </>
                                    )
                                  ) : (
                                    <p className="text-xs text-gray-500 italic leading-relaxed">{r.addSizeExplanation}</p>
                                  )}
                                </div>
                              )
                            })()}
                            {r.suggestedPartialExitPct != null && (
                              <div className="border-t border-gpw-border pt-2">
                                <p className="text-[10px] text-yellow-500 font-semibold uppercase tracking-wide mb-1">📤 Częściowa realizacja</p>
                                <p className="text-xs text-gray-300 leading-relaxed">
                                  AI sugeruje sprzedaż <span className="text-yellow-400 font-bold">{r.suggestedPartialExitPct}% pozycji</span> — informacyjnie. Zamknięcie realizuj przez przycisk poniżej.
                                </p>
                              </div>
                            )}
                            <div className="flex gap-2 border-t border-gpw-border pt-2">
                              <button
                                onClick={async () => {
                                  const text = buildPositionShareText(pos, r, indics[pos.id])
                                  try {
                                    if (navigator.share) {
                                      await navigator.share({ title: `GPW Analyzer — ${pos.tickerDisplay ?? pos.ticker}`, text })
                                    } else {
                                      await navigator.clipboard.writeText(text)
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
