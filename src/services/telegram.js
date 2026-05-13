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

export function formatGEMAlert(result, prevResult, portfolio) {
  const month     = new Date().toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
  const cspxPct   = result.cspx12m != null ? `${(result.cspx12m * 100).toFixed(1)}%` : '—'
  const swrdPct   = result.swrd12m != null ? `${(result.swrd12m * 100).toFixed(1)}%` : '—'
  const cashPct   = `${(result.cashRate * 100).toFixed(1)}%`
  const step1Line = result.step1Passed
    ? `Krok 1 ✅ Trend wzrostowy\nCSPX 12m: ${cspxPct} > gotówka ${cashPct}`
    : `Krok 1 ❌ Rynek słaby\nCSPX 12m: ${cspxPct} < gotówka ${cashPct}`
  const step2Line = result.step1Passed
    ? (result.decision === 'world'
        ? `Krok 2 🌍 Świat silniejszy\nSWRD: ${swrdPct} > CSPX: ${cspxPct}`
        : `Krok 2 🇺🇸 USA silniejsze\nCSPX: ${cspxPct} >= SWRD: ${swrdPct}`)
    : ''

  const portfolioLine = portfolio?.investedAmount
    ? `\n💰 Twój portfel GEM: ${portfolio.investedAmount.toLocaleString('pl-PL')} PLN`
    : ''

  const isRotation = prevResult && prevResult.etf !== result.etf && prevResult.etf !== undefined
  const isDefensive = result.decision === 'bonds'
  const wasDefensive = prevResult?.decision === 'bonds'

  if (isDefensive && (wasDefensive || !prevResult)) {
    return `🛡️ <b>GEM — PRZEGLĄD MIESIĘCZNY</b>\n📅 ${month}\n\n${step1Line}\n\n📌 BEZ ZMIAN: trzymaj ${result.etf} (obligacje)\nTryb ochrony kapitału aktywny${portfolioLine}\n\n⚠️ Analiza edukacyjna. Decyzja należy do Ciebie.\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz aplikację → Długoterminowe</a>`
  }

  if (isDefensive) {
    const taxNote = portfolio?.gainAmount > 0
      ? `\n⚠️ Szacowany podatek Belki: ~${Math.round(portfolio.gainAmount * 0.19).toLocaleString('pl-PL')} PLN (19% od zysku)`
      : '\n⚠️ Pamiętaj o podatku Belki (19% od zysku) przy sprzedaży'
    return `🚨 <b>GEM — SYGNAŁ OBRONNY!</b>\n📅 ${month}\n\n${step1Line}\n\n📌 ZMIEŃ: ${prevResult?.etf ?? 'akcje'} → AGGH (obligacje globalne)\nSprzedaj obecny ETF, kup AGGH w XTB${taxNote}${portfolioLine}\n\n🛡️ Tryb ochrony kapitału aktywny\n\n⚠️ Analiza edukacyjna. Decyzja należy do Ciebie.\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz aplikację → Długoterminowe</a>`
  }

  if (isRotation) {
    const taxNote = portfolio?.gainAmount > 0
      ? `⚠️ Szacowany podatek Belki: ~${Math.round(portfolio.gainAmount * 0.19).toLocaleString('pl-PL')} PLN (19% od zysku)`
      : '⚠️ Pamiętaj o podatku Belki (19% od zysku) przy sprzedaży'
    return `🔄 <b>GEM — ROTACJA WYMAGANA!</b>\n📅 ${month}\n\n${step1Line}\n${step2Line}\n\n📌 ZMIEŃ: ${prevResult.etf} → ${result.etf}\nSprzedaj ${prevResult.etf}, kup ${result.etf} w XTB\n\n${taxNote}${portfolioLine}\n\n⚠️ Analiza edukacyjna. Decyzja należy do Ciebie.\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz aplikację → Długoterminowe</a>`
  }

  return `🌍 <b>GEM — PRZEGLĄD MIESIĘCZNY</b>\n📅 ${month}\n\n${step1Line}\n${step2Line}\n\n📌 BEZ ZMIAN: trzymaj ${result.etf}\n${result.etfName}${portfolioLine}\n\n⚠️ Analiza edukacyjna. Decyzja należy do Ciebie.\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz aplikację → Długoterminowe</a>`
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
