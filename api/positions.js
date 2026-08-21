import { createClient } from '@vercel/kv'
import { fetchCurrent } from '../src/lib/yahoo.js'

const ENV_PREFIX = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  const { method } = req
  const { mode } = req.query

  // ── Watchlist CRUD ──────────────────────────────────────────────────────
  if (mode === 'watchlist') {
    if (method === 'POST') {
      const { ticker, exchange, strategy, signal, priceAtAnalysis,
              entryZoneMin, entryZoneMax, stopLoss, target,
              aiDecision, aiSummary, aiRecommendation, buffettScore, confidence,
              reviewDays } = req.body
      if (!ticker || !aiDecision) return res.status(400).json({ error: 'ticker and aiDecision required' })
      const ts = Date.now()
      const id = `${ENV_PREFIX}:watch:${ticker}:${ts}`
      const reviewDate = reviewDays
        ? new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null
      const { rsi, volMult, score } = req.body
      const item = {
        id, ticker, exchange: exchange ?? 'NYSE', strategy, signal,
        priceAtAnalysis, entryZoneMin: entryZoneMin ?? null, entryZoneMax: entryZoneMax ?? null,
        stopLoss, target, aiDecision, aiSummary, aiRecommendation,
        buffettScore, confidence, reviewDate,
        rsi: rsi ?? null, volMult: volMult ?? null, score: score ?? null,
        createdAt: new Date().toISOString(), status: 'active',
      }
      await kv.set(id, item, { ex: 60 * 24 * 60 * 60 })
      return res.json(item)
    }

    if (method === 'PATCH') {
      const { id, status, aiDecision, aiSummary, aiRecommendation,
              buffettScore, compositeScore, signalStrength, confidence,
              entryZoneMin, entryZoneMax,
              reviewDays, rsi, volMult, score } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      const item = await kv.get(id).catch(() => null)
      if (!item) return res.status(404).json({ error: 'not found' })
      const updated = { ...item }
      if (status)     updated.status = status
      if (aiDecision) {
        updated.aiDecision       = aiDecision
        updated.aiSummary        = aiSummary        ?? item.aiSummary
        updated.aiRecommendation = aiRecommendation ?? item.aiRecommendation
        updated.buffettScore     = buffettScore     ?? item.buffettScore
        updated.confidence       = confidence       ?? item.confidence
        if (compositeScore  !== undefined) updated.compositeScore  = compositeScore
        if (signalStrength  !== undefined) updated.signalStrength  = signalStrength
        if (entryZoneMin    !== undefined) updated.entryZoneMin    = entryZoneMin
        if (entryZoneMax    !== undefined) updated.entryZoneMax    = entryZoneMax
        if (rsi     !== undefined) updated.rsi     = rsi
        if (volMult !== undefined) updated.volMult = volMult
        if (score   !== undefined) updated.score   = score
        if (reviewDays) updated.reviewDate = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        updated.lastValidatedAt = new Date().toISOString()
      }
      await kv.set(id, updated, { ex: 60 * 24 * 60 * 60 })
      return res.json(updated)
    }

    if (method === 'DELETE') {
      const { id } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      await kv.del(id)
      return res.json({ deleted: id })
    }

    if (method === 'GET') {
      let cursor = 0
      const items = []
      do {
        const [next, keys] = await kv.scan(cursor, { match: `${ENV_PREFIX}:watch:*`, count: 100 })
        cursor = Number(next)
        if (keys.length) {
          const vals = await Promise.all(keys.map(k => kv.get(k).catch(() => null)))
          items.push(...vals.filter(Boolean))
        }
      } while (cursor !== 0)

      // Auto-delete expired items from KV, return only active
      const toDelete = items.filter(w => {
        if (w.status === 'expired') return true
        if (w.reviewDate) {
          const expiry = new Date(w.reviewDate)
          expiry.setDate(expiry.getDate() + 3)
          if (new Date() > expiry) return true
        }
        return false
      })
      if (toDelete.length) {
        await Promise.allSettled(toDelete.map(w => kv.del(w.id).catch(() => {})))
      }

      const active = items.filter(w => !toDelete.includes(w))
      const livePrices = await Promise.allSettled(
        active.map(w => fetchCurrent(w.ticker, w.exchange).catch(() => null))
      )
      active.forEach((w, i) => {
        const p = livePrices[i].status === 'fulfilled' ? livePrices[i].value : null
        w.livePrice = p?.close ?? null
      })
      active.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      return res.json(active)
    }

    return res.status(405).end()
  }

  if (method === 'POST') {
    // Otwórz pozycję
    const { ticker, strategy, exchange, entryPrice, positionSize, target, stopLoss, signal,
            entryRsi, entryRsiPeriod, entryScore, entryVolMult, entrySma50Delta,
            entrySma150trend, entryNearSupport, entryIndexTrend, aiValidation } = req.body
    if (!ticker || !entryPrice || !positionSize) {
      return res.status(400).json({ error: 'ticker, entryPrice, positionSize required' })
    }
    const ts  = Date.now()
    const id  = `${ENV_PREFIX}:position:${ticker}:${ts}`
    const lifecycleKey = `${ENV_PREFIX}:lifecycle:${ticker}:${ts}`
    const position = {
      id,
      lifecycleKey,
      ticker,
      tickerDisplay: exchange === 'NYSE' ? ticker.toUpperCase() : ticker.replace('.pl', '').toUpperCase(),
      strategy,
      exchange:  exchange ?? 'GPW',
      signal,
      entryPrice,
      entryRsi:          entryRsi          ?? null,
      entryRsiPeriod:    entryRsiPeriod    ?? null,
      entryScore:        entryScore        ?? null,
      entryVolMult:      entryVolMult      ?? null,
      entrySma50Delta:   entrySma50Delta   ?? null,
      entrySma150trend:  entrySma150trend  ?? null,
      entryNearSupport:  entryNearSupport  ?? null,
      entryIndexTrend:   entryIndexTrend   ?? null,
      positionSize,
      shares: Math.floor(positionSize / entryPrice),
      target,
      stopLoss,
      entryDate: new Date().toISOString(),
      status: 'open',
      exitPrice: null,
      exitDate: null,
    }
    const lifecycle = {
      ticker, exchange: position.exchange, signal, entryPrice, entryDate: position.entryDate,
      entryScore: entryScore ?? null, status: 'open', evaluations: [],
      aiEntry: aiValidation ?? null,
    }
    await Promise.all([
      kv.set(id, position, { ex: 365 * 24 * 60 * 60 }),
      kv.set(lifecycleKey, lifecycle, { ex: 365 * 24 * 60 * 60 }),
    ])
    return res.json(position)
  }

  if (method === 'PATCH') {
    const { id, exitPrice, target, stopLoss } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const position = await kv.get(id)
    if (!position) return res.status(404).json({ error: 'Position not found' })

    // AI-revised target or stop loss for open position
    if (!exitPrice && (target != null || stopLoss != null)) {
      const updated = { ...position }
      if (target   != null) updated.target   = target
      if (stopLoss != null) updated.stopLoss = stopLoss
      await kv.set(id, updated, { ex: 365 * 24 * 60 * 60 })
      return res.json(updated)
    }

    if (!exitPrice) return res.status(400).json({ error: 'id, exitPrice required' })
    const exitDate = new Date().toISOString()
    const pnlPct   = Math.round(((exitPrice - position.entryPrice) / position.entryPrice) * 10000) / 100
    const pnlPln   = Math.round((exitPrice - position.entryPrice) * position.shares * 100) / 100
    const daysHeld = Math.floor((new Date(exitDate) - new Date(position.entryDate)) / 86400000)
    const updated  = { ...position, exitPrice, exitDate, status: 'closed', pnlPct, pnlPln }
    const lk = position.lifecycleKey ?? id.replace(':position:', ':lifecycle:')
    const existingLC = await kv.get(lk).catch(() => null)
    await Promise.all([
      kv.set(id, updated),
      existingLC
        ? kv.set(lk, { ...existingLC, exitPrice, exitDate, pnlPct, status: 'closed' })
        : Promise.resolve(),
    ])

    // Powiąż wynik z alertem KV → aktualizuj targetAchieved i actualGainPct
    if (position.strategy && position.ticker) {
      try {
        const alertKeys = await kv.keys(`${ENV_PREFIX}:alert:${position.strategy}:${position.ticker}:*`)
        if (alertKeys.length) {
          const raw = await Promise.all(alertKeys.map(k => kv.get(k).then(a => a ? { ...a, _key: k } : null)))
          const related = raw
            .filter(a => a && new Date(a.timestamp) <= new Date(position.entryDate))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0]
          if (related) {
            const { _key, ...alertData } = related
            await kv.set(_key, {
              ...alertData,
              targetAchieved: pnlPct >= (position.target ?? 0),
              actualGainPct:  pnlPct,
              daysHeld,
            }, { ex: 365 * 24 * 60 * 60 })
          }
        }
      } catch {}
    }

    return res.json(updated)
  }

  if (method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    const position = await kv.get(id)
    if (!position) return res.status(404).json({ error: 'Position not found' })
    if (position.status !== 'closed') return res.status(400).json({ error: 'Only closed positions can be deleted' })
    await kv.del(id)
    return res.json({ deleted: id })
  }

  if (method === 'GET') {
    // Pobierz pozycje (open lub closed)
    const { status = 'open' } = req.query
    const keys = await kv.keys(`${ENV_PREFIX}:position:*`)
    if (!keys.length) return res.json([])
    const all = await Promise.all(keys.map(k => kv.get(k)))
    const filtered = all.filter(p => p && (status === 'all' || p.status === status))
    filtered.sort((a, b) => new Date(b.entryDate) - new Date(a.entryDate))
    return res.json(filtered)
  }

  res.status(405).end()
}
