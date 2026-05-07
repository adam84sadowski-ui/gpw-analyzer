import { createClient } from '@vercel/kv'
import { fetchCurrent, fetchCandles } from '../../src/lib/yahoo.js'
import { sendTelegram } from '../../src/services/telegram.js'
import { calcRSI } from '../../src/indicators/rsi.js'
import { calcSMA } from '../../src/indicators/sma.js'
import { isBreakout } from '../../src/indicators/breakout.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const MAX_DAYS = { scalping: 5, swing: 40, aggressive: 30 }
const TARGET_ALERT_THRESHOLD = 0.8
const STOP_ALERT_THRESHOLD   = 0.8

function checkSignalStillValid(signal, candles) {
  if (!candles || candles.length < 25) return true
  const closes = candles.map(c => c.close)
  const price  = closes[closes.length - 1]
  if (signal === 'RSI_OVERSOLD') {
    const rsi = calcRSI(closes)
    return rsi === null || rsi <= 55
  }
  if (signal === 'SMA50_CROSSOVER') {
    const sma50 = calcSMA(closes, 50)
    return !sma50 || price >= sma50 * 0.98
  }
  if (signal === 'BREAKOUT') {
    return isBreakout(candles)
  }
  return true
}

function signalExpiredText(signal, candles) {
  if (!candles) return ''
  const closes = candles.map(c => c.close)
  if (signal === 'RSI_OVERSOLD') {
    const rsi = calcRSI(closes)
    return `RSI: ${rsi?.toFixed(1) ?? '—'} (przestał być wyprzedany — powyżej 55)`
  }
  if (signal === 'SMA50_CROSSOVER') {
    const sma50 = calcSMA(closes, 50)
    const price = closes[closes.length - 1]
    return `Cena: ${price?.toFixed(2)} | SMA50: ${sma50?.toFixed(2)} (cena spadła poniżej SMA50)`
  }
  if (signal === 'BREAKOUT') {
    return 'Cena nie utrzymuje wybicia powyżej max 20 dni'
  }
  return ''
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const keys = await kv.keys(`${ENV}:position:*`).catch(() => [])
  if (!keys.length) return res.json({ checked: 0, alerts: 0 })

  const positions = (await Promise.all(keys.map(k => kv.get(k).catch(() => null))))
    .filter(p => p && p.status === 'open')

  let alertsSent = 0

  for (const pos of positions) {
    try {
      const exchange = pos.exchange ?? 'GPW'
      const currency = exchange === 'NYSE' ? 'USD' : 'PLN'
      const current = await fetchCurrent(pos.ticker, exchange)
      if (!current?.close) continue

      const price      = current.close
      const pnlPct     = (price - pos.entryPrice) / pos.entryPrice
      const targetFrac = pos.target / 100
      const stopFrac   = pos.stopLoss / 100
      const daysHeld   = Math.floor((Date.now() - new Date(pos.entryDate)) / 86400000)
      const maxDays    = MAX_DAYS[pos.strategy] ?? 30

      const dedup = async (type, ttlHours = 23) => {
        const key = `${ENV}:pos-alert:${pos.id}:${type}`
        const exists = await kv.get(key).catch(() => null)
        if (exists) return true
        await kv.set(key, 1, { ex: ttlHours * 60 * 60 }).catch(() => {})
        return false
      }

      const ticker = pos.tickerDisplay ?? pos.ticker.replace('.pl','').toUpperCase()

      if (pnlPct >= targetFrac * TARGET_ALERT_THRESHOLD) {
        if (!(await dedup('target'))) {
          const pct = (pnlPct * 100).toFixed(1)
          await sendTelegram(
            `🎯 <b>CEL BLISKO — ${ticker}</b>\n\nP&L: +${pct}% z celem +${pos.target}%\nCena: ${price} ${currency}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>\n\n<i>Rozważ realizację zysku.</i>`,
            IS_STAGING
          )
          alertsSent++
        }
      } else if (pnlPct <= -(stopFrac * STOP_ALERT_THRESHOLD)) {
        if (!(await dedup('stop'))) {
          const pct = (pnlPct * 100).toFixed(1)
          await sendTelegram(
            `🛑 <b>STOP LOSS BLISKO — ${ticker}</b>\n\nP&L: ${pct}% przy stop -${pos.stopLoss}%\nCena: ${price} ${currency}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>\n\n<i>Rozważ zamknięcie pozycji.</i>`,
            IS_STAGING
          )
          alertsSent++
        }
      }

      if (daysHeld > maxDays) {
        if (!(await dedup('horizon'))) {
          const strategyRec = {
            scalping:   `Strategia scalping zakłada zamknięcie pozycji w 2-5 dni. Pozycja jest otwarta już ${daysHeld} dni — oceń czy nadal jest uzasadniona.`,
            swing:      `Strategia swing zakłada horyzont 4-8 tygodni. Pozycja przekroczyła ${maxDays} dni — sprawdź czy trend wzrostowy nadal obowiązuje.`,
            aggressive: `Strategia agresywna nie ma stałego horyzontu, ale pozycja jest otwarta ${daysHeld} dni. Oceń ryzyko i rozważ realizację wyniku.`,
          }[pos.strategy] ?? `Pozycja otwarta ${daysHeld} dni (max ${maxDays}). Rozważ zamknięcie.`
          await sendTelegram(
            `⏰ <b>HORYZONT PRZEKROCZONY — ${ticker}</b>\n\nP&L: ${(pnlPct*100).toFixed(1)}%  |  Cena: ${price} ${currency}\n\n💡 ${strategyRec}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
            IS_STAGING
          )
          alertsSent++
        }
      }

      // Signal reversal check — skip if near target or stop (those alerts take priority)
      if (pos.signal && pos.signal !== 'TEST'
          && pnlPct < targetFrac * 0.9
          && pnlPct > -(stopFrac * 0.8)) {
        const candleData = await fetchCandles(pos.ticker, exchange).catch(() => null)
        const candles = candleData?.candles
        if (candles && !checkSignalStillValid(pos.signal, candles)) {
          if (!(await dedup('signal-change', 48))) {
            const detail = signalExpiredText(pos.signal, candles)
            await sendTelegram(
              `🔄 <b>ZMIANA SYGNAŁU — ${ticker}</b>\n\nSygnał <b>${pos.signal}</b> który otworzył pozycję wygasł.\n${detail}\n\nP&L teraz: ${(pnlPct*100).toFixed(1)}%\nCel: +${pos.target}% | Stop: -${pos.stopLoss}%\n\n💡 Rozważ realizację wyniku — sygnał do wejścia już nie działa. Trzymasz ${daysHeld} z ${maxDays} dni horyzontu.\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
              IS_STAGING
            )
            alertsSent++
          }
        }
      }
    } catch (e) {
      console.error(`positions-monitor: error for ${pos.ticker}:`, e.message)
    }
  }

  res.json({ checked: positions.length, alerts: alertsSent })
}
