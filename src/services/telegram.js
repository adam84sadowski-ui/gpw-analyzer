export async function sendTelegram(message, isStaging = false) {
  const token = isStaging
    ? process.env.TELEGRAM_BOT_TOKEN_STAGING
    : process.env.TELEGRAM_BOT_TOKEN
  const chatId = isStaging
    ? process.env.TELEGRAM_CHAT_ID_STAGING
    : process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) throw new Error('Telegram env vars not configured')

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  })

  if (!res.ok) throw new Error(`Telegram error: ${res.status}`)
  return res.json()
}

export function formatAlert({ ticker, strategy, price, signal, target, stopLoss, portfolio, positionSize, shares, description, exchange, currency, companyName, horizon, interpretation }) {
  const cur          = currency ?? 'PLN'
  const exchangeFlag = exchange === 'NYSE' ? '🇺🇸' : '🇵🇱'
  const targetPLN    = (price * (1 + target / 100)).toFixed(2)
  const stopPLN      = (price * (1 - stopLoss / 100)).toFixed(2)
  const time         = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

  let interpretBlock = ''
  if (interpretation) {
    const lines = [interpretation.text]
    interpretation.positives?.forEach(p => lines.push(p))
    interpretation.warnings?.forEach(w  => lines.push(w))
    interpretBlock = `\n📖 <b>CO ROBIĆ:</b>\n${lines.join('\n')}\n`
  }

  return `📊 <b>SYGNAŁ: ${ticker}${companyName ? ` (${companyName})` : ''} | ${strategy} ${exchangeFlag}</b>
🕐 ${time} | Cena: ${price} ${cur}

💡 <b>CO SIĘ DZIEJE:</b>
${description}
${interpretBlock}
🎯 Cel: +${target}% (${targetPLN} ${cur}) | 🛑 Stop: -${stopLoss}% (${stopPLN} ${cur})
${horizon ? `⏱ Horyzont: ${horizon}\n` : ''}
💰 Portfel: ${portfolio} ${cur}
📌 Pozycja: ${positionSize} ${cur} = ~${shares} akcji po ${price} ${cur}

📱 <a href="https://gpw-analyzer.vercel.app">Otwórz GPW Analyzer → Moje wyniki</a>

⚠️ <i>Analiza edukacyjna. Decyzja należy do Ciebie.</i>`
}
