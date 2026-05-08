// ── NYSE: FRED live data ──────────────────────────────────────────────────

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
  const current = vals[vals.length - 1]
  const yearAgo = vals[vals.length - 13]
  return Math.round((current / yearAgo - 1) * 1000) / 10
}

// ── GPW: NBP XML + Eurostat ───────────────────────────────────────────────

async function fetchNbpRefRate() {
  const url = 'https://static.nbp.pl/dane/stopy/stopy_procentowe_archiwum.xml'
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const xml  = await res.text()
  // Find all <pozycje> blocks, take the last one (most recent)
  const blocks = xml.match(/<pozycje[\s\S]*?<\/pozycje>/g)
  if (!blocks?.length) return null
  const last   = blocks[blocks.length - 1]
  const match  = last.match(/id="ref"[^/]*oprocentowanie="([^"]+)"/)
  if (!match) return null
  return parseFloat(match[1].replace(',', '.'))
}

async function fetchEurostatCpiYoY() {
  const url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=PL&coicop=CP00&format=JSON&lang=EN'
  const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const data  = await res.json()
  const vals  = Object.entries(data.value ?? {}).filter(([, v]) => v != null)
  if (!vals.length) return null
  vals.sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  return vals[vals.length - 1][1]
}

// ── Shared logic ──────────────────────────────────────────────────────────

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

  // GPW — NBP XML + Eurostat HICP
  try {
    const [nbpRate, cpi] = await Promise.all([
      fetchNbpRefRate(),
      fetchEurostatCpiYoY(),
    ])
    if (nbpRate == null || cpi == null) throw new Error('NBP/Eurostat fetch failed')
    const { status, scoreAdjustment } = calcMacroStatus(nbpRate, cpi)
    return { status, fedRate: Math.round(nbpRate * 100) / 100, cpi: Math.round(cpi * 10) / 10, scoreAdjustment, source: 'NBP+Eurostat', updatedAt: new Date().toISOString() }
  } catch {
    return { status: 'NEUTRALNE', fedRate: null, cpi: null, scoreAdjustment: 0, source: 'fallback', updatedAt: new Date().toISOString() }
  }
}

export function formatMacroLine(macro, exchange) {
  if (!macro || macro.status === 'NEUTRALNE') return ''
  const label  = exchange === 'NYSE' ? `Fed ${macro.fedRate}%` : `NBP ${macro.fedRate}%`
  const cpiStr = macro.cpi != null ? `, CPI ${macro.cpi}%` : ''
  const emoji  = macro.status === 'RYZYKOWNE' ? '🔴' : '🟡'
  return `${emoji} Makro ${macro.status}: ${label}${cpiStr} → score ${macro.scoreAdjustment > 0 ? '+' : ''}${macro.scoreAdjustment} pkt`
}
