// Polish NBP reference rate — no public REST API exists for this.
// Updated manually each quarter. Last update: 2026-Q2
const NBP_REFERENCE_RATE = 5.75
const NBP_CPI            = 4.9
const NBP_UPDATED        = '2026-05-01'

async function fetchFredValue(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const csv  = await res.text()
  const rows = csv.trim().split('\n').slice(1)
  const vals = rows.map(r => parseFloat(r.split(',')[1])).filter(v => !isNaN(v))
  return vals.length ? vals[vals.length - 1] : null
}

async function fetchFredCpiYoY() {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL`
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const csv  = await res.text()
  const rows = csv.trim().split('\n').slice(1)
  const vals = rows.map(r => parseFloat(r.split(',')[1])).filter(v => !isNaN(v))
  if (vals.length < 13) return null
  const current  = vals[vals.length - 1]
  const yearAgo  = vals[vals.length - 13]
  return Math.round((current / yearAgo - 1) * 1000) / 10
}

function calcMacroStatus(rate, cpi) {
  if (rate >= 5 && cpi >= 4) return { status: 'RYZYKOWNE', scoreAdjustment: -25 }
  if (rate >= 4 && cpi >= 3) return { status: 'UWAGA',      scoreAdjustment: -10 }
  return                            { status: 'NEUTRALNE',  scoreAdjustment:   0 }
}

export async function getMacroEnvironment(exchange = 'GPW') {
  if (exchange === 'NYSE') {
    try {
      const [fedRate, cpi] = await Promise.all([
        fetchFredValue('FEDFUNDS'),
        fetchFredCpiYoY(),
      ])
      if (fedRate == null || cpi == null) throw new Error('FRED fetch failed')
      const { status, scoreAdjustment } = calcMacroStatus(fedRate, cpi)
      return { status, fedRate: Math.round(fedRate * 100) / 100, cpi: Math.round(cpi * 10) / 10, scoreAdjustment, source: 'FRED', updatedAt: new Date().toISOString() }
    } catch {
      return { status: 'NEUTRALNE', fedRate: null, cpi: null, scoreAdjustment: 0, source: 'fallback', updatedAt: new Date().toISOString() }
    }
  }

  // GPW — Polish macro (NBP, no public API)
  const { status, scoreAdjustment } = calcMacroStatus(NBP_REFERENCE_RATE, NBP_CPI)
  return { status, fedRate: NBP_REFERENCE_RATE, cpi: NBP_CPI, scoreAdjustment, source: 'NBP_static', updatedAt: NBP_UPDATED }
}

export function formatMacroLine(macro, exchange) {
  if (!macro || macro.status === 'NEUTRALNE') return ''
  const label   = exchange === 'NYSE' ? `Fed ${macro.fedRate}%` : `NBP ${macro.fedRate}%`
  const cpiStr  = macro.cpi != null ? `, CPI ${macro.cpi}%` : ''
  const emoji   = macro.status === 'RYZYKOWNE' ? '🔴' : '🟡'
  return `${emoji} Makro ${macro.status}: ${label}${cpiStr} → score ${macro.scoreAdjustment > 0 ? '+' : ''}${macro.scoreAdjustment} pkt`
}
