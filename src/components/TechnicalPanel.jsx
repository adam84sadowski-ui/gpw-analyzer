function Row({ label, val, sub, warn, highlight }) {
  return (
    <div className={`rounded p-2 ${warn ? 'bg-gpw-red/10 ring-1 ring-gpw-red/30' : highlight ? 'bg-gpw-green/10 ring-1 ring-gpw-green/30' : 'bg-gpw-dark'}`}>
      <div className="text-gray-500 text-[10px] mb-0.5">{label}</div>
      <div className="font-bold text-gray-200 text-[11px] leading-tight">{val}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{sub}</div>}
    </div>
  )
}

function SectionHead({ children }) {
  return <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-1.5 mt-0.5">{children}</p>
}

export default function TechnicalPanel({ data, price: priceProp, loading }) {
  if (loading) return <p className="text-xs text-gray-500 animate-pulse py-2">Ładuję wskaźniki…</p>
  if (!data) return null

  const {
    rsi, rsiPeriod,
    sma20, sma50, sma150, sma150trend, sma150Warning,
    volMult, price: dataPrice, atr, atrPct,
    nearSupport, bollinger, macd, macdScore, bollingerScore,
    score, dynamicStopLoss, divergence, indexTrend,
  } = data

  const px = priceProp ?? dataPrice

  const rsiInterp = rsi == null ? null
    : rsi >= 70 ? '🔴 wykupiony — ostrożnie z wejściem'
    : rsi >= 60 ? '🟡 silny — trend wzrostowy'
    : rsi >= 50 ? '⚪ lekko pozytywny'
    : rsi >= 40 ? '⚪ lekko negatywny'
    : rsi >= 30 ? '🟡 słaby — trend spadkowy'
    : '🟢 wyprzedany — potencjalne odbicie'

  const macdTrend = macd?.trend === 'bullish' ? '🟢 byczy'
    : macd?.trend === 'bearish' ? '🔴 niedźwiedzi'
    : '⚪ neutralny'

  const bbInterp = !bollinger ? '—'
    : bollinger.status === 'above_upper' ? '🔴 powyżej górnej wstęgi'
    : bollinger.status === 'below_lower' ? '🟢 poniżej dolnej wstęgi'
    : bollinger.status === 'consolidation' ? '⚪ konsolidacja'
    : '⚪ środek kanału'

  const smaRel = (smaVal) => {
    if (px == null || smaVal == null) return null
    return px > smaVal ? '✅ cena powyżej' : '⚠️ cena poniżej'
  }

  const volInterp = volMult == null ? null
    : volMult >= 2.5 ? '🔥 bardzo wysoki — silne potwierdzenie'
    : volMult >= 1.5 ? '📈 wysoki — potwierdzenie ruchu'
    : volMult >= 1   ? '➡️ normalny'
    : '📉 niski — słabe potwierdzenie'

  const atrInterp = atrPct == null ? null
    : atrPct > 3   ? '🔴 wysoka zmienność'
    : atrPct > 1.5 ? '⚪ umiarkowana zmienność'
    : '🟢 niska zmienność'

  const indexInterp = indexTrend === 'up'   ? '📈 wzrostowy — korzystne otoczenie'
    : indexTrend === 'down'    ? '📉 spadkowy — ryzykowne wejście'
    : indexTrend === 'neutral' ? '➡️ neutralny'
    : '—'

  const divInterp = divergence === 'bullish'  ? '🟢 bycza — sygnał odwrócenia w górę'
    : divergence === 'bearish' ? '🔴 niedźwiedzia — sygnał słabnięcia'
    : null

  const slPct = px && dynamicStopLoss
    ? ((px - dynamicStopLoss) / px * 100).toFixed(1)
    : null

  return (
    <div className="space-y-3 text-xs">
      {score != null && (
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Score techniczny</span>
            <span className={`font-bold ${score >= 80 ? 'text-gpw-green' : score >= 60 ? 'text-yellow-400' : 'text-gray-300'}`}>{score}/100</span>
          </div>
          <div className="bg-gpw-border rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${score >= 80 ? 'bg-gpw-green' : score >= 60 ? 'bg-yellow-500' : 'bg-gpw-red'}`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      )}

      <div>
        <SectionHead>📊 Trend</SectionHead>
        <div className="grid grid-cols-2 gap-1.5">
          {sma20 != null && <Row label="SMA20" val={sma20.toFixed(2)} sub={smaRel(sma20)} />}
          {sma50 != null && <Row label="SMA50" val={sma50.toFixed(2)} sub={smaRel(sma50)} />}
          {sma150 != null && (
            <Row
              label="SMA150"
              val={sma150.toFixed(2)}
              sub={sma150Warning ? '⚠️ poniżej SMA150 — ostrzeżenie' : smaRel(sma150)}
              warn={!!sma150Warning}
            />
          )}
          <Row label="Indeks rynkowy" val={indexInterp} />
        </div>
      </div>

      <div>
        <SectionHead>⚡ Momentum</SectionHead>
        <div className="grid grid-cols-2 gap-1.5">
          <Row
            label={`RSI(${rsiPeriod ?? 14})`}
            val={rsi?.toFixed(1) ?? '—'}
            sub={rsiInterp}
            warn={rsi != null && rsi >= 75}
            highlight={rsi != null && rsi <= 30}
          />
          <Row
            label="Dywergencja RSI"
            val={divInterp ?? '⚪ brak'}
            highlight={divergence === 'bullish'}
            warn={divergence === 'bearish'}
          />
          <Row
            label="MACD histogram"
            val={macd?.histogram != null ? macd.histogram.toFixed(3) : '—'}
            sub={macdTrend}
            highlight={macd?.trend === 'bullish'}
            warn={macd?.trend === 'bearish'}
          />
          {macdScore != null && <Row label="MACD score" val={`${macdScore}/100`} />}
        </div>
      </div>

      <div>
        <SectionHead>📉 Zmienność</SectionHead>
        <div className="grid grid-cols-2 gap-1.5">
          {atrPct != null && (
            <Row label="ATR%" val={`${atrPct}%`} sub={atrInterp} warn={atrPct > 3} />
          )}
          {atr != null && <Row label="ATR (abs)" val={atr.toFixed(2)} />}
          {bollinger && (
            <Row
              label="Bollinger"
              val={bbInterp}
              sub={bollingerScore != null ? `Score: ${bollingerScore}/100` : undefined}
              highlight={bollinger.status === 'below_lower'}
              warn={bollinger.status === 'above_upper'}
            />
          )}
          {bollinger?.upper != null && <Row label="BB górna" val={bollinger.upper.toFixed(2)} sub="poziom oporu" />}
          {bollinger?.lower != null && <Row label="BB dolna" val={bollinger.lower.toFixed(2)} sub="poziom wsparcia" />}
        </div>
      </div>

      <div>
        <SectionHead>🏗️ Struktura</SectionHead>
        <div className="grid grid-cols-2 gap-1.5">
          <Row
            label="Wolumen"
            val={volMult != null ? `${volMult}x` : '—'}
            sub={volInterp}
            highlight={volMult != null && volMult >= 1.5}
          />
          <Row
            label="Wsparcie"
            val={nearSupport != null ? String(nearSupport) : '—'}
            sub={nearSupport != null ? '🔵 blisko poziomu wsparcia' : '⚪ brak bliskiego wsparcia'}
            highlight={nearSupport != null}
          />
          {dynamicStopLoss != null && (
            <Row
              label="Stop ATR"
              val={dynamicStopLoss.toFixed(2)}
              sub={slPct ? `−${slPct}% od bieżącej ceny` : undefined}
            />
          )}
        </div>
      </div>
    </div>
  )
}
