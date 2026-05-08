async function fetchFredValue(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const csv  = await res.text()
  const rows = csv.trim().split('\n').slice(1)
  const vals = rows.map(r => parseFloat(r.split(',')[1])).filter(v => !isNaN(v))
  return vals.length ? vals[vals.length - 1] : null
}

async function fetchFredCpiYoY(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const csv  = await res.text()
  const rows = csv.trim().split('\n').slice(1)
  const vals = rows.map(r => parseFloat(r.split(',')[1])).filter(v => !isNaN(v))
  if (vals.length < 13) return null
  const current = vals[vals.length - 1]
  const yearAgo = vals[vals.length - 13]
  return Math.round((current / yearAgo - 1) * 1000) / 10
}

function calcMacroStatus(rate, cpi) {
  if (rate >= 5 && cpi >= 4) return { status: 'RYZYKOWNE', scoreAdjustment: -25 }
  if (rate >= 4 && cpi >= 3) return { status: 'UWAGA',      scoreAdjustment: -10 }
  return                            { status: 'NEUTRALNE',  scoreAdjustment:   0 }
}

export async function getMacroEnvironment(exchange = 'GPW') {
  // NYSE: Fed Funds Rate + US CPI
  // GPW:  NBP Central Bank Rate (IRSTCB01PLM156N) + Poland CPI (POLCPIALLMINMEI)
  const [rateSeriesId, cpiSeriesId] = exchange === 'NYSE'
    ? ['FEDFUNDS',         'CPIAUCSL']
    : ['IRSTCB01PLM156N',  'POLCPIALLMINMEI']

  try {
    const [rate, cpi] = await Promise.all([
      fetchFredValue(rateSeriesId),
      fetchFredCpiYoY(cpiSeriesId),
    ])
    if (rate == null || cpi == null) throw new Error('FRED fetch failed')
    const { status, scoreAdjustment } = calcMacroStatus(rate, cpi)
    return {
      status,
      fedRate: Math.round(rate * 100) / 100,
      cpi:     Math.round(cpi  * 10)  / 10,
      scoreAdjustment,
      source:    'FRED',
      updatedAt: new Date().toISOString(),
    }
  } catch {
    return {
      status: 'NEUTRALNE', fedRate: null, cpi: null,
      scoreAdjustment: 0, source: 'fallback', updatedAt: new Date().toISOString(),
    }
  }
}

export function formatMacroLine(macro, exchange) {
  if (!macro || macro.status === 'NEUTRALNE') return ''
  const label  = exchange === 'NYSE' ? `Fed ${macro.fedRate}%` : `NBP ${macro.fedRate}%`
  const cpiStr = macro.cpi != null ? `, CPI ${macro.cpi}%` : ''
  const emoji  = macro.status === 'RYZYKOWNE' ? '🔴' : '🟡'
  return `${emoji} Makro ${macro.status}: ${label}${cpiStr} → score ${macro.scoreAdjustment > 0 ? '+' : ''}${macro.scoreAdjustment} pkt`
}
