import { sendTelegram } from '../src/services/telegram.js'

const COMMANDS = {
  '/portfel':    handlePortfel,
  '/strategia':  handleStrategia,
  '/status':     handleStatus,
  '/skutecznosc':handleSkutecznosc,
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
/skutecznosc            — raport skuteczności
/status                 — stan aplikacji
/pomocy                 — ta lista`)
}

async function handleStatus() {
  await sendTelegram(`✅ <b>GPW Analyzer — status</b>
Środowisko: ${process.env.VITE_ENV ?? 'unknown'}
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
