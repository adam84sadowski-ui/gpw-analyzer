import { createClient } from '@vercel/kv'

const ENV_PREFIX = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  const { method } = req

  if (method === 'POST') {
    // Otwórz pozycję
    const { ticker, strategy, exchange, entryPrice, positionSize, target, stopLoss, signal,
            entryRsi, entryRsiPeriod, entryScore, entryVolMult, entrySma50Delta,
            entrySma150trend, entryNearSupport, entryIndexTrend } = req.body
    if (!ticker || !entryPrice || !positionSize) {
      return res.status(400).json({ error: 'ticker, entryPrice, positionSize required' })
    }
    const id = `${ENV_PREFIX}:position:${ticker}:${Date.now()}`
    const position = {
      id,
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
    await kv.set(id, position, { ex: 365 * 24 * 60 * 60 })
    return res.json(position)
  }

  if (method === 'PATCH') {
    // Zamknij pozycję
    const { id, exitPrice } = req.body
    if (!id || !exitPrice) return res.status(400).json({ error: 'id, exitPrice required' })
    const position = await kv.get(id)
    if (!position) return res.status(404).json({ error: 'Position not found' })
    const exitDate = new Date().toISOString()
    const pnlPct   = Math.round(((exitPrice - position.entryPrice) / position.entryPrice) * 10000) / 100
    const pnlPln   = Math.round((exitPrice - position.entryPrice) * position.shares * 100) / 100
    const daysHeld = Math.floor((new Date(exitDate) - new Date(position.entryDate)) / 86400000)
    const updated  = { ...position, exitPrice, exitDate, status: 'closed', pnlPct, pnlPln }
    await kv.set(id, updated)

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
