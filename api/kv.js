import { createClient } from '@vercel/kv'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const ENV = process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'

export function prefixKey(key) {
  return `${ENV}:${key}`
}

export default async function handler(req, res) {
  const { method } = req

  if (method === 'GET') {
    const { key } = req.query
    if (!key) return res.status(400).json({ error: 'key required' })
    const value = await kv.get(prefixKey(key))
    return res.json({ value })
  }

  if (method === 'POST') {
    const { key, value, ex } = req.body
    if (!key) return res.status(400).json({ error: 'key required' })
    if (ex) {
      await kv.set(prefixKey(key), value, { ex })
    } else {
      await kv.set(prefixKey(key), value)
    }
    return res.json({ ok: true })
  }

  res.status(405).end()
}
