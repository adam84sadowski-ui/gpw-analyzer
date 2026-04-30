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

export function formatAlert({ ticker, strategy, price, signal, target, stopLoss, portfolio, positionSize, shares, description, history, learning }) {
  return `📊 <b>SYGNAŁ: ${ticker} | ${strategy}</b>
🕐 ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} | Cena: ${price} PLN

💡 <b>CO SIĘ DZIEJE:</b>
${description}

📅 <b>HISTORIA (ostatnie 12 mies.):</b>
${history}

🧠 <b>CZEGO NAUCZYŁEM SIĘ:</b>
${learning}

🎯 CEL: +${target}% | ⚠️ STOP LOSS: -${stopLoss}%

💰 PORTFEL: ${portfolio} PLN
📌 Pozycja: ${positionSize} PLN = ~${shares} akcji po ${price} PLN

📱 Zaloguj się do iPKO → Dom Maklerski

⚠️ <i>Analiza edukacyjna. Decyzja należy do Ciebie.</i>`
}
