import { useState } from 'react'

const DECISION_STYLE = {
  'WEJDŹ':   { icon: '✅', cls: 'text-gpw-green'  },
  'OBSERWUJ':{ icon: '⏳', cls: 'text-yellow-400' },
  'UNIKAJ':  { icon: '❌', cls: 'text-gpw-red'    },
}

function BuffettMeter({ score }) {
  const filled = Math.min(10, Math.max(0, score))
  const color  = filled >= 8 ? 'bg-gpw-green' : filled >= 5 ? 'bg-yellow-400' : 'bg-gpw-red'
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`w-2.5 h-2.5 rounded-sm ${i < filled ? color : 'bg-gpw-border'}`} />
        ))}
      </div>
      <span className="text-xs font-bold text-gray-300">{filled}/10</span>
    </div>
  )
}

const FRAMEWORK_LABEL = {
  scalping:   'PTJ (Momentum)',
  aggressive: "O'Neil CANSLIM",
  swing:      'Buffett/Lynch',
}

export default function EntryValidationModal({ rec, strategy, exchange, livePrice, watchlistItemId, onOpenPosition, onClose }) {
  const [selectedStrategy, setSelectedStrategy] = useState(strategy)
  const frameworkLabel = FRAMEWORK_LABEL[selectedStrategy] ?? 'Fundamentalna'
  const [state,  setState]  = useState('idle') // idle | loading | result
  const [result, setResult] = useState(null)
  const [error,  setError]  = useState(null)
  const [chatMsgs,    setChatMsgs]    = useState([])
  const [chatInput,   setChatInput]   = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [copied,      setCopied]      = useState(false)
  const currency = exchange === 'NYSE' ? 'USD' : 'PLN'

  const sma50Delta = rec.sma50 && rec.price
    ? ((rec.price - rec.sma50) / rec.sma50 * 100).toFixed(1)
    : 0

  async function sendFollowUp() {
    if (!chatInput.trim() || !result) return
    const userMsg = { role: 'user', content: chatInput.trim() }
    const newMsgs = [...chatMsgs, userMsg]
    setChatMsgs(newMsgs)
    setChatInput('')
    setChatLoading(true)

    const CHAT_PERSONA = {
      scalping: `Jesteś asystentem inwestycyjnym GPW Analyzer w stylu Paul Tudor Jones.\nWłaśnie przeprowadziłeś analizę PTJ (Momentum) dla ${rec.tickerDisplay ?? rec.ticker}.\n\nWYNIK: ${result.decision} | Score PTJ: ${result.buffettScore}/10 | Pewność: ${result.confidence}%\n${result.summary}\n\nOdpowiadasz na pytania o ten setup SCALPINGOWY (horyzont 2-5 dni).\nTwój styl: dyscyplina ryzyka, R/R 2:1, "cut losers fast, let winners run".\nJeśli momentum gaśnie — mówisz wprost: wychodź.\nOdpowiadasz po polsku. To analiza edukacyjna — nie jest poradą inwestycyjną.`,
      aggressive: `Jesteś asystentem inwestycyjnym GPW Analyzer w stylu William O'Neil (CANSLIM).\nWłaśnie przeprowadziłeś analizę O'Neil CANSLIM dla ${rec.tickerDisplay ?? rec.ticker}.\n\nWYNIK: ${result.decision} | Score CANSLIM: ${result.buffettScore}/10 | Pewność: ${result.confidence}%\n${result.summary}\n\nOdpowiadasz na pytania o ten setup BREAKOUT (horyzont 1-4 tygodnie).\nTwój styl: szukasz liderów z przyspieszającymi zyski, wybijającymi się z bazy z wolumenem.\nZasada nadrzędna: cut losses at -8%, no exceptions.\nOdpowiadasz po polsku. To analiza edukacyjna — nie jest poradą inwestycyjną.`,
      swing: `Jesteś asystentem inwestycyjnym GPW Analyzer w stylu Buffett/Lynch.\nWłaśnie przeprowadziłeś analizę Buffett/Lynch dla ${rec.tickerDisplay ?? rec.ticker}.\n\nWYNIK: ${result.decision} | Score fundamentalny: ${result.buffettScore}/10 | Pewność: ${result.confidence}%\n${result.summary}\n\nOdpowiadasz na pytania o tę pozycję SWING (horyzont 4-8 tygodni).\nTwój styl: inwestujesz w biznesy, nie tickery. Trzymasz gdy fundamenty silne, sprzedajesz gdy historia się kończy.\nOdpowiadasz po polsku. To analiza edukacyjna — nie jest poradą inwestycyjną.`,
    }
    const system = CHAT_PERSONA[selectedStrategy] ?? CHAT_PERSONA.swing

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: newMsgs, system }),
      })
      const data = await res.json()
      setChatMsgs(m => [...m, { role: 'assistant', content: data.content ?? 'Błąd AI.' }])
    } catch {
      setChatMsgs(m => [...m, { role: 'assistant', content: 'Błąd połączenia — spróbuj ponownie.' }])
    } finally {
      setChatLoading(false)
    }
  }

  async function validate() {
    setState('loading')
    setError(null)
    try {
      const effectiveLive = livePrice ?? rec.livePrice ?? null
      const params = new URLSearchParams({
        mode:        'ai-validate',
        ticker:      rec.ticker,
        exchange,
        strategy:    selectedStrategy ?? 'swing',
        signal:      rec.signal  ?? '',
        score:       rec.score   ?? 0,
        rsi:         rec.rsi     ?? 50,
        volMult:     rec.volMult ?? 1,
        sma50Delta,
        signalPrice: rec.price   ?? '',
        ...(effectiveLive != null ? { livePrice: effectiveLive } : {}),
      })
      const res  = await fetch(`/api/market?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
      setState('result')
    } catch {
      setError('Błąd AI — spróbuj ponownie.')
      setState('idle')
    }
  }

  const ds = DECISION_STYLE[result?.decision] ?? { icon: '—', cls: 'text-gray-400' }

  async function shareResult() {
    const ICON = { 'WEJDŹ': '✅', 'OBSERWUJ': '👁', 'UNIKAJ': '❌' }
    const lines = [
      `📊 ${rec.tickerDisplay ?? rec.ticker} · ${(selectedStrategy ?? strategy).toUpperCase()}`,
      `${ICON[result.decision] ?? '📊'} ${result.decision} | Score: ${result.compositeScore ?? result.buffettScore ?? '—'} | Pewność: ${result.confidence}%`,
      result.suggestedTargetPct ? `Cel AI: +${result.suggestedTargetPct}%` : null,
      result.summary ? `💡 ${result.summary.slice(0, 120)}${result.summary.length > 120 ? '…' : ''}` : null,
      '— GPW Analyzer (analiza edukacyjna)',
    ].filter(Boolean).join('\n')
    try {
      if (navigator.share) {
        await navigator.share({ title: `GPW Analyzer — ${rec.tickerDisplay ?? rec.ticker}`, text: lines })
      } else {
        await navigator.clipboard.writeText(lines)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch { /* user cancelled share */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 px-3 pb-4 sm:pb-0"
      onClick={onClose}
    >
      <div
        className="bg-gpw-dark border border-gpw-border rounded-xl w-full max-w-sm flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div className="p-4 border-b border-gpw-border flex justify-between items-start shrink-0">
          <div>
            <span className="font-bold text-lg">{rec.tickerDisplay}</span>
            {rec.companyName && <span className="text-xs text-gray-500 ml-1.5">({rec.companyName})</span>}
            <div className="text-xs text-gray-400 mt-0.5">
              {rec.signal ?? strategy} · {livePrice && livePrice !== rec.price
                ? <>{livePrice} <span className="text-yellow-500">zam. {rec.price}</span></>
                : rec.price
              } {currency}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {/* Indicators grid */}
          <div className="grid grid-cols-3 gap-2 text-xs text-center">
            <div className="bg-gpw-card rounded p-2">
              <div className="text-gray-400">RSI</div>
              <div className="font-bold">{rec.rsi?.toFixed(1) ?? '—'}</div>
            </div>
            <div className="bg-gpw-card rounded p-2">
              <div className="text-gray-400">Score</div>
              <div className="font-bold">{rec.score ?? '—'}/100</div>
            </div>
            <div className="bg-gpw-card rounded p-2">
              <div className="text-gray-400">Wolumen</div>
              <div className="font-bold">{rec.volMult != null ? `${rec.volMult}x` : '—'}</div>
            </div>
          </div>

          {/* CTA / result */}
          {state === 'idle' && (
            <>
              <div className="space-y-1.5">
                <p className="text-xs text-gray-500">Strategia walidacji</p>
                <div className="flex gap-1.5">
                  {[
                    { key: 'scalping',   label: '⚡ Scalping' },
                    { key: 'swing',      label: '📈 Swing' },
                    { key: 'aggressive', label: '🚀 Agresywna' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setSelectedStrategy(key)}
                      className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors ${
                        selectedStrategy === key
                          ? 'bg-gpw-blue border-gpw-blue text-white'
                          : 'bg-gpw-card border-gpw-border text-gray-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selectedStrategy !== strategy && (
                  <p className="text-[10px] text-yellow-400">
                    ⚠️ Sygnał z {FRAMEWORK_LABEL[strategy] ?? strategy} — walidacja przez pryzmat {FRAMEWORK_LABEL[selectedStrategy]}
                  </p>
                )}
              </div>
              {error && <p className="text-xs text-gpw-red text-center">{error}</p>}
              <button
                onClick={validate}
                className="w-full bg-gpw-blue hover:bg-blue-600 text-white py-3 rounded-lg font-semibold transition-colors"
              >
                🤖 Analizuj z AI ({frameworkLabel})
              </button>
            </>
          )}

          {state === 'loading' && (
            <div className="text-center py-8 space-y-2">
              <div className="text-sm text-gray-400 animate-pulse">Analizuję z Claude AI…</div>
              <div className="text-xs text-gray-600">Sprawdzam 13 punktów — {frameworkLabel}</div>
            </div>
          )}

          {state === 'result' && result && (
            <div className="space-y-3">
              {/* Decision header */}
              <div className="bg-gpw-card rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold ${ds.cls}`}>{ds.icon} {result.decision}</span>
                    {selectedStrategy !== strategy && (
                      <span className="text-[10px] bg-gpw-blue/20 text-blue-300 px-2 py-0.5 rounded border border-gpw-blue/30">
                        {FRAMEWORK_LABEL[selectedStrategy]}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Pewność AI</div>
                    <div className="text-sm font-bold text-white">{result.confidence}%</div>
                  </div>
                </div>
                <div className="bg-gpw-border rounded-full h-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${result.confidence >= 70 ? 'bg-gpw-green' : result.confidence >= 50 ? 'bg-yellow-500' : 'bg-gpw-red'}`}
                    style={{ width: `${result.confidence}%` }}
                  />
                </div>

                {/* Composite score — synteza techniczna + AI */}
                {result.compositeScore != null && (
                  <div className="bg-gpw-dark rounded-lg px-3 py-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-400">
                        Sygnał tech:&nbsp;
                        <span className="font-mono text-gray-300">{rec.score ?? '—'}/100</span>
                        <span className="text-gray-600 mx-1.5">→</span>
                        <span className="font-bold text-white">Wynik AI: {result.compositeScore}/100</span>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        result.signalStrength === 'BARDZO SILNY' ? 'bg-gpw-green/20 text-gpw-green' :
                        result.signalStrength === 'SILNY'        ? 'bg-green-900/40 text-green-400' :
                        result.signalStrength === 'UMIARKOWANY'  ? 'bg-yellow-700/30 text-yellow-400' :
                        'bg-gpw-red/20 text-gpw-red'
                      }`}>{result.signalStrength ?? '—'}</span>
                    </div>
                    <div className="bg-gpw-border rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${result.compositeScore >= 70 ? 'bg-gpw-green' : result.compositeScore >= 50 ? 'bg-yellow-500' : 'bg-gpw-red'}`}
                        style={{ width: `${result.compositeScore}%` }}
                      />
                    </div>
                  </div>
                )}

                {result.buffettScore != null && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-400">Wynik Analizy ({frameworkLabel})</div>
                    <BuffettMeter score={result.buffettScore} />
                    <div className="text-xs text-gray-500">
                      {result.buffettScore >= 8 ? 'Silna okazja fundamentalna'
                        : result.buffettScore >= 5 ? 'Potencjał, ale ryzyka'
                        : 'Słabe fundamenty — ostrożnie'}
                    </div>
                  </div>
                )}
                {result.targetMeanPrice != null && (
                  <div className="bg-gpw-dark rounded-lg px-3 py-2 space-y-1.5">
                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">📊 Konsensus analityków</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300">
                        Mediana: <span className="font-bold text-white">{result.targetMeanPrice} {currency}</span>
                      </span>
                      <span className={`text-sm font-bold ${result.targetUpside > 0 ? 'text-gpw-green' : 'text-gpw-red'}`}>
                        {result.targetUpside > 0 ? '+' : ''}{result.targetUpside}%
                      </span>
                    </div>
                    {result.analystBuy != null && (
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-gpw-green font-semibold">{result.analystBuy} Kup</span>
                        <span className="text-gray-400">{result.analystHold ?? 0} Trzymaj</span>
                        <span className="text-gpw-red">{result.analystSell ?? 0} Sprzedaj</span>
                        {result.recommendationKey && (
                          <span className="text-gray-500 ml-auto">{result.recommendationKey.toUpperCase()}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {result.suggestedTargetPct != null && (
                  <div className="flex items-center gap-2 text-xs bg-gpw-dark rounded px-3 py-1.5">
                    <span className="text-gray-400">Cel AI:</span>
                    <span className="font-bold text-gpw-green">+{result.suggestedTargetPct}% 🤖</span>
                    {rec.target != null && rec.target !== result.suggestedTargetPct && (
                      <span className="text-gray-600 line-through text-[10px]">+{rec.target}%</span>
                    )}
                  </div>
                )}
                {result.summary && (
                  <p className="text-xs text-yellow-300 leading-relaxed border-t border-gpw-border pt-2">
                    💡 {result.summary}
                  </p>
                )}
              </div>

              {/* Checklist analysis */}
              {result.analysis && (
                <div className="bg-gpw-card border border-gpw-border rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">📋 Analiza ({frameworkLabel})</p>
                  <pre className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">{result.analysis}</pre>
                </div>
              )}

              {/* Plan działania */}
              {result.recommendation && (
                <div className="bg-gpw-dark border border-gpw-border rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
                    {result.decision === 'UNIKAJ' ? '🚫 Dlaczego unikać' : '🎯 Plan wejścia'}
                  </p>
                  <pre className="text-sm text-white leading-relaxed whitespace-pre-wrap font-sans">{result.recommendation}</pre>
                </div>
              )}

              {/* Share */}
              <button
                onClick={shareResult}
                className="w-full flex items-center justify-center gap-2 bg-gpw-card hover:bg-gpw-border border border-gpw-border text-gray-300 hover:text-white py-2 rounded-lg text-xs font-medium transition-colors"
              >
                {copied ? '✅ Skopiowano!' : '🔗 Udostępnij wynik'}
              </button>

              {/* Follow-up Q&A */}
              <div className="bg-gpw-card border border-gpw-border rounded-lg p-3 space-y-2">
                <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">💬 Pytania do analizy</p>
                {chatMsgs.length === 0 && (
                  <p className="text-xs text-gray-500 italic">Masz pytania dotyczące tej analizy? Zapytaj...</p>
                )}
                <div className="space-y-2 max-h-36 overflow-y-auto">
                  {chatMsgs.map((m, i) => (
                    <div key={i} className={`text-xs rounded p-2 leading-relaxed ${m.role === 'user' ? 'bg-gpw-blue/20 text-white' : 'bg-gpw-dark text-gray-300'}`}>
                      <span className="text-gray-500 text-[10px] block mb-0.5">{m.role === 'user' ? 'Ty' : 'AI'}</span>
                      {m.content}
                    </div>
                  ))}
                  {chatLoading && <p className="text-xs text-gray-400 animate-pulse">AI odpowiada…</p>}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Zapytaj o tę analizę…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) sendFollowUp() }}
                    className="flex-1 bg-gpw-dark border border-gpw-border rounded px-2 py-1.5 text-xs outline-none focus:border-gpw-blue"
                    disabled={chatLoading}
                  />
                  <button
                    onClick={sendFollowUp}
                    disabled={chatLoading || !chatInput.trim()}
                    className="bg-gpw-blue hover:bg-blue-600 disabled:opacity-40 text-white px-3 rounded text-xs transition-colors"
                  >
                    →
                  </button>
                </div>
              </div>

              {result.decision === 'WEJDŹ' ? (
                <button
                  onClick={() => { onClose(); onOpenPosition(rec, result) }}
                  className="w-full bg-gpw-green hover:bg-green-600 text-white py-3 rounded-lg font-semibold transition-colors"
                >
                  ✅ Realizuję wejście
                </button>
              ) : (
                <button
                  onClick={validate}
                  className="w-full bg-gpw-card text-gray-400 hover:text-white py-2 rounded-lg text-sm transition-colors"
                >
                  🔄 Sprawdź ponownie
                </button>
              )}

              {result.decision && (
                <button
                  disabled={saved}
                  onClick={async () => {
                    try {
                      if (watchlistItemId) {
                        await fetch('/api/positions?mode=watchlist', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            id:               watchlistItemId,
                            aiDecision:       result.decision,
                            aiSummary:        result.summary,
                            aiRecommendation: result.recommendation,
                            buffettScore:     result.buffettScore,
                            compositeScore:   result.compositeScore  ?? null,
                            signalStrength:   result.signalStrength  ?? null,
                            confidence:       result.confidence,
                            entryZoneMin:     result.entryZoneMin ?? null,
                            entryZoneMax:     result.entryZoneMax ?? null,
                            reviewDays:       result.reviewDays ?? 10,
                            rsi:              rec.rsi     ?? null,
                            volMult:          rec.volMult ?? null,
                            score:            rec.score   ?? null,
                            ...(result.suggestedTargetPct != null ? { target: result.suggestedTargetPct } : {}),
                          }),
                        })
                      } else {
                        await fetch('/api/positions?mode=watchlist', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            ticker:           rec.ticker,
                            exchange,
                            strategy:         selectedStrategy ?? 'swing',
                            signal:           rec.signal ?? '',
                            priceAtAnalysis:  rec.price ?? livePrice,
                            entryZoneMin:     result.entryZoneMin ?? null,
                            entryZoneMax:     result.entryZoneMax ?? null,
                            stopLoss:         rec.stopLoss ?? null,
                            target:           result.suggestedTargetPct ?? rec.target ?? null,
                            aiDecision:       result.decision,
                            aiSummary:        result.summary,
                            aiRecommendation: result.recommendation,
                            buffettScore:     result.buffettScore,
                            compositeScore:   result.compositeScore  ?? null,
                            signalStrength:   result.signalStrength  ?? null,
                            confidence:       result.confidence,
                            reviewDays:       result.reviewDays ?? 10,
                            rsi:              rec.rsi     ?? null,
                            volMult:          rec.volMult ?? null,
                            score:            rec.score   ?? null,
                          }),
                        })
                      }
                      setSaved(true)
                    } catch { /* silent */ }
                  }}
                  className={`w-full disabled:opacity-50 border py-2 rounded-lg text-sm font-medium transition-colors ${
                    saved
                      ? 'bg-gpw-green/20 border-gpw-green/40 text-gpw-green'
                      : result.decision === 'OBSERWUJ'
                        ? 'bg-yellow-600/20 hover:bg-yellow-600/40 border-yellow-600/40 text-yellow-300'
                        : 'bg-gpw-card hover:bg-gpw-border border-gpw-border text-gray-400 hover:text-white'
                  }`}
                >
                  {saved
                    ? (watchlistItemId ? '✅ Zaktualizowano' : '✅ Zapisano do obserwowanych')
                    : (watchlistItemId ? '🔄 Aktualizuj obserwowaną' : '💾 Zapisz do obserwowanych')
                  }
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer — fixed */}
        <div className="p-3 border-t border-gpw-border shrink-0">
          <p className="text-xs text-gray-500 text-center">⚠️ Analiza edukacyjna AI — nie jest poradą inwestycyjną.</p>
        </div>
      </div>
    </div>
  )
}
