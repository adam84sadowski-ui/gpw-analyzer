export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker required' })

  const key = process.env.EODHD_API_KEY
  if (!key) return res.status(503).json({ error: 'EODHD not configured' })

  try {
    const url = `https://eodhd.com/api/fundamentals/${ticker}.WAR?api_token=${key}&fmt=json&filter=Highlights::PERatio,Highlights::DividendYield`
    const r = await fetch(url)
    if (!r.ok) return res.status(r.status).json({ error: 'EODHD error' })
    const data = await r.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
