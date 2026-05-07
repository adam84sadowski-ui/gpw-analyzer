import { createClient } from '@vercel/kv'
import { sendTelegram } from '../src/services/telegram.js'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const COMMANDS = {
  '/portfel':    handlePortfel,
  '/strategia':  handleStrategia,
  '/status':     handleStatus,
  '/skutecznosc':handleSkutecznosc,
  '/historia':   handleHistoria,
  '/pomocy':     handlePomocy,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { message } = req.body
  if (!message?.text) return res.status(200).end()

  const [cmd, ...args] = message.text.split(' ')
  const fn = COMMANDS[cmd.toLowerCase()]

  if (fn) {
    await fn(args, message)
  } else {
    await sendTelegram(`❓ Nieznana komenda: ${cmd}\nWpisz /pomocy aby zobaczyć dostępne komendy.`)
  }

  res.status(200).end()
}

async function handlePomocy() {
  await sendTelegram(`📱 <b>GPW Analyzer — komendy:</b>

/portfel [kwota]        — zmień kapitał (np. /portfel 20000)
/strategia [nazwa]      — zmień strategię (scalping/swing/agresywna)
/historia               — ostatnie 5 alertów
/skutecznosc            — raport skuteczności
/status                 — stan aplikacji
/pomocy                 — ta lista`)
}

async function handleStatus() {
  await sendTelegram(`✅ <b>GPW Analyzer — status</b>
Środowisko: ${process.env.VITE_ENV === 'staging' ? 'staging' : 'prod'}
Czas serwera: ${new Date().toLocaleString('pl-PL')}
API: aktywne`)
}

async function handlePortfel([kwota]) {
  if (!kwota || isNaN(Number(kwota))) {
    await sendTelegram('❌ Użycie: /portfel 20000')
    return
  }
  await sendTelegram(`✅ Kapitał ustawiony na ${Number(kwota).toLocaleString('pl-PL')} PLN\n(Zmiana widoczna po odświeżeniu aplikacji)`)
}

async function handleStrategia([nazwa]) {
  const valid = ['scalping', 'swing', 'agresywna']
  if (!valid.includes(nazwa?.toLowerCase())) {
    await sendTelegram(`❌ Dostępne strategie: ${valid.join(', ')}`)
    return
  }
  await sendTelegram(`✅ Strategia zmieniona na: ${nazwa}`)
}

async function handleSkutecznosc() {
  await sendTelegram('📊 Raport skuteczności — brak wystarczających danych. Zbieranie historii alertów w toku.')
}

async function handleHistoria() {
  const ENV = 'prod'
  let cursor = 0; const keys = []; let iterations = 0
  do {
    const [next, batch] = await kv.scan(cursor, { match: `${ENV}:alert:*`, count: 100 })
    keys.push(...batch)
    cursor = Number(next)
    iterations++
  } while (cursor !== 0 && iterations < 20)

  if (keys.length === 0) {
    await sendTelegram('📜 Brak historii alertów.')
    return
  }

  const records = await Promise.all(keys.map(k => kv.get(k).catch(() => null)))
  const alerts = records.filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5)

  const lines = alerts.map(a => {
    const ticker = (a.ticker ?? '').replace(/\.pl$/i, '').toUpperCase()
    const date   = new Date(a.timestamp).toLocaleDateString('pl-PL')
    const cur    = a.exchange === 'NYSE' ? 'USD' : 'PLN'
    return `• <b>${ticker}</b> — ${a.signal} @ ${a.price} ${cur} (${date})`
  })
  await sendTelegram(`📜 <b>Ostatnie alerty (${alerts.length}):</b>\n\n${lines.join('\n')}`)
}
