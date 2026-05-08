const STRATEGY_BOUNDS = {
  scalping:   { targetMin: 3,  targetMax: 10,  defaultTarget: 5  },
  swing:      { targetMin: 8,  targetMax: 25,  defaultTarget: 15 },
  aggressive: { targetMin: 15, targetMax: 60,  defaultTarget: 35 },
}

const HORIZON_DEFAULTS = {
  scalping:   '2-5 dni',
  swing:      '4-8 tyg.',
  aggressive: 'trudny do określenia',
}

const HORIZON_BOUNDS = {
  scalping:   { minDays: 1,  maxDays: 10  },
  swing:      { minDays: 14, maxDays: 84  },
  aggressive: { minDays: 3,  maxDays: 180 },
}

function formatDaysRange(minD, maxD) {
  const fmt = d => d < 14 ? `${d} dni` : `${Math.round(d / 7)} tyg.`
  return `${fmt(minD)}–${fmt(maxD)}`
}

export async function calcDynamicTarget(kv, ticker, strategy, env) {
  const bounds = STRATEGY_BOUNDS[strategy]
  const fallback = { target: bounds.defaultTarget, source: 'default', samples: 0 }
  try {
    const keys = await kv.keys(`${env}:alert:${strategy}:${ticker}:*`)
    if (!keys.length) return fallback
    const alerts = await Promise.all(keys.map(k => kv.get(k)))
    const withResults = alerts.filter(a => a && a.actualGainPct != null && a.targetAchieved === true)
    if (withResults.length < 3) return { ...fallback, samples: withResults.length }
    const avg = withResults.reduce((s, a) => s + a.actualGainPct, 0) / withResults.length
    const raw = avg * 0.8
    const target = Math.round(Math.min(bounds.targetMax, Math.max(bounds.targetMin, raw)) * 10) / 10
    return { target, source: 'historical', samples: withResults.length }
  } catch {
    return fallback
  }
}

export async function calcDynamicHorizon(kv, ticker, strategy, env) {
  const fallback = { horizon: HORIZON_DEFAULTS[strategy], source: 'default', samples: 0 }
  try {
    const keys = await kv.keys(`${env}:alert:${strategy}:${ticker}:*`)
    if (!keys.length) return fallback
    const alerts = await Promise.all(keys.map(k => kv.get(k)))
    const withDays = alerts.filter(a => a && a.daysHeld != null && a.targetAchieved === true)
    if (withDays.length < 3) return { ...fallback, samples: withDays.length }
    const avg = withDays.reduce((s, a) => s + a.daysHeld, 0) / withDays.length
    const b = HORIZON_BOUNDS[strategy]
    const minD = Math.max(b.minDays, Math.floor(avg * 0.6))
    const maxD = Math.min(b.maxDays, Math.ceil(avg * 1.5))
    return { horizon: formatDaysRange(minD, maxD), source: 'historical', samples: withDays.length }
  } catch {
    return fallback
  }
}
