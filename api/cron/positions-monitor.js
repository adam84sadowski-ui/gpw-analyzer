import { createClient } from '@vercel/kv'
import { fetchCurrent, fetchCandles } from '../../src/lib/yahoo.js'
import { sendTelegram } from '../../src/services/telegram.js'
import { calcRSI } from '../../src/indicators/rsi.js'
import { calcSMA } from '../../src/indicators/sma.js'
import { isBreakout } from '../../src/indicators/breakout.js'
import { calculateMACD, getMACDSignal } from '../../src/indicators/macd.js'
import { fetchIndexTrend } from '../../src/lib/indextrend.js'

const IS_STAGING = process.env.VITE_ENV === 'staging'
const ENV = IS_STAGING ? 'staging' : 'prod'

const kv = createClient({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const MAX_DAYS = { scalping: 5, swing: 40, aggressive: 30 }
const TARGET_ALERT_THRESHOLD = 0.8
const STOP_ALERT_THRESHOLD   = 0.8

async function getCurrentPrice(ticker, exchange) {
  const current = await fetchCurrent(ticker, exchange).catch(() => null)
  if (current?.close) return current.close
  const data = await fetchCandles(ticker, exchange).catch(() => null)
  const candles = data?.candles
  return candles?.length ? candles[candles.length - 1].close : null
}

function checkSignalStillValid(signal, candles, strategy) {
  if (!candles || candles.length < 25) return true
  const closes  = candles.map(c => c.close)
  const price   = closes[closes.length - 1]
  const sma150  = calcSMA(closes, 150)
  const belowSma150 = sma150 != null && price <= sma150

  if (signal === 'RSI_OVERSOLD') {
    const rsi = calcRSI(closes)
    if (belowSma150) return false
    return rsi === null || rsi <= 55
  }
  if (signal === 'SMA50_CROSSOVER') {
    const sma50 = calcSMA(closes, 50)
    if (belowSma150) return false
    return !sma50 || price >= sma50 * 0.98
  }
  if (signal === 'BREAKOUT') {
    return isBreakout(candles)
  }
  return true
}

function signalExpiredText(signal, candles) {
  if (!candles) return ''
  const closes  = candles.map(c => c.close)
  const price   = closes[closes.length - 1]
  const sma150  = calcSMA(closes, 150)
  if (sma150 != null && price <= sma150) {
    return `Cena (${price?.toFixed(2)}) poniżej SMA150 (${sma150?.toFixed(2)}) — długoterminowy trend spadkowy`
  }
  if (signal === 'RSI_OVERSOLD') {
    const rsi = calcRSI(closes)
    return `RSI: ${rsi?.toFixed(1) ?? '—'} (przestał być wyprzedany — powyżej 55)`
  }
  if (signal === 'SMA50_CROSSOVER') {
    const sma50 = calcSMA(closes, 50)
    return `Cena: ${price?.toFixed(2)} | SMA50: ${sma50?.toFixed(2)} (cena spadła poniżej SMA50)`
  }
  if (signal === 'BREAKOUT') {
    return 'Cena nie utrzymuje wybicia powyżej max 20 dni'
  }
  return ''
}

function checkMACDBearish(candles) {
  if (!candles || candles.length < 35) return false
  const closes = candles.map(c => c.close)
  const macd   = calculateMACD(closes)
  const sig    = getMACDSignal(macd)
  return sig.trend === 'bearish' && sig.score < 0
}

const WHAT_TO_DO = {
  target: (strategy) => {
    if (strategy === 'scalping')   return '💡 Co robić: Rozważ zamknięcie całej pozycji i realizację zysku — scalping wymaga szybkich decyzji.'
    if (strategy === 'swing')      return '💡 Co robić: Rozważ realizację 50-75% pozycji. Resztę trzymaj z stop loss przesuniętym na cenę wejścia (break-even).'
    if (strategy === 'aggressive') return '💡 Co robić: Możesz trzymać dalej jeśli trend silny, ale rozważ realizację części zysku i zacieśnienie stop lossa.'
    return '💡 Co robić: Rozważ częściową realizację zysku.'
  },
  stop: (strategy) => {
    if (strategy === 'scalping')   return '💡 Co robić: Zamknij pozycję natychmiast. Scalping nie toleruje dużych strat — każda złotówka kapitału się liczy.'
    if (strategy === 'swing')      return '💡 Co robić: Rozważ zamknięcie pozycji. Stop loss istnieje po to, by chronić kapitał przed większą stratą.'
    if (strategy === 'aggressive') return '💡 Co robić: Poważnie rozważ zamknięcie. Strategia agresywna ma wysoki zysk, ale też wymaga dyscypliny przy stop lossie.'
    return '💡 Co robić: Rozważ zamknięcie pozycji — stop loss chroni twój kapitał.'
  },
  horizon: (strategy, daysHeld) => {
    if (strategy === 'scalping')   return `💡 Co robić: Scalping zakłada 2-5 dni. Masz już ${daysHeld} dni — zamknij pozycję niezależnie od wyniku.`
    if (strategy === 'swing')      return `💡 Co robić: Sprawdź czy trend wzrostowy nadal obowiązuje (SMA50, MACD). Jeśli tak — możesz trzymać. Jeśli nie — zamknij.`
    if (strategy === 'aggressive') return `💡 Co robić: Strategia agresywna po ${daysHeld} dniach wymaga oceny — czy teza inwestycyjna nadal jest aktualna?`
    return `💡 Co robić: Pozycja przekroczyła zalecany horyzont — rozważ zamknięcie.`
  },
  signalChange: () =>
    '💡 Co robić: Sygnał który uzasadniał wejście już nie działa. Bez uzasadnienia technicznego ryzyko rośnie — rozważ zamknięcie pozycji.',
  macdBearish: () =>
    '💡 Co robić: MACD wskazuje zmianę trendu na spadkowy. Rozważ zacieśnienie stop lossa lub zamknięcie części pozycji.',
  indexDown: () =>
    '💡 Co robić: Rynek jako całość jest w trendzie spadkowym. Rozważ zacieśnienie stop lossa — ryzyko systemowe wzrosło.',
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

      const price = await getCurrentPrice(pos.ticker, exchange)
      if (!price) continue

      const pnlPct      = (price - pos.entryPrice) / pos.entryPrice
      const stopPct     = (pos.dynamicStopLoss ?? pos.stopLoss) / 100
      const targetFrac  = pos.target / 100
      const entryDay    = new Date(pos.entryDate.slice(0, 10))
      const today       = new Date(new Date().toISOString().slice(0, 10))
      const daysHeld    = Math.round((today - entryDay) / 86400000)
      const maxDays     = MAX_DAYS[pos.strategy] ?? 30
      const ticker      = pos.tickerDisplay ?? pos.ticker.replace('.pl', '').toUpperCase()

      const dedup = async (type, ttlHours = 23) => {
        const key    = `${ENV}:pos-alert:${pos.id}:${type}`
        const exists = await kv.get(key).catch(() => null)
        if (exists) return true
        await kv.set(key, 1, { ex: ttlHours * 60 * 60 }).catch(() => {})
        return false
      }

      // 1. CEL BLISKO
      if (pnlPct >= targetFrac * TARGET_ALERT_THRESHOLD) {
        if (!(await dedup('target'))) {
          await sendTelegram(
            `🎯 <b>CEL BLISKO — ${ticker}</b>\n\nP&L: +${(pnlPct * 100).toFixed(1)}% z celem +${pos.target}%\nCena: ${price} ${currency}\n\n${WHAT_TO_DO.target(pos.strategy)}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
            IS_STAGING
          )
          alertsSent++
        }

      // 2. STOP LOSS BLISKO (używa dynamicStopLoss jeśli dostępny)
      } else if (pnlPct <= -(stopPct * STOP_ALERT_THRESHOLD)) {
        if (!(await dedup('stop'))) {
          const stopLabel = pos.dynamicStopLoss ? `ATR stop ${pos.dynamicStopLoss}%` : `stop ${pos.stopLoss}%`
          await sendTelegram(
            `🛑 <b>STOP LOSS BLISKO — ${ticker}</b>\n\nP&L: ${(pnlPct * 100).toFixed(1)}% przy ${stopLabel}\nCena: ${price} ${currency}\n\n${WHAT_TO_DO.stop(pos.strategy)}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
            IS_STAGING
          )
          alertsSent++
        }
      }

      // 3. HORYZONT PRZEKROCZONY
      if (daysHeld > maxDays) {
        if (!(await dedup('horizon'))) {
          await sendTelegram(
            `⏰ <b>HORYZONT PRZEKROCZONY — ${ticker}</b>\n\nP&L: ${(pnlPct * 100).toFixed(1)}%  |  Cena: ${price} ${currency}\n\n${WHAT_TO_DO.horizon(pos.strategy, daysHeld)}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
            IS_STAGING
          )
          alertsSent++
        }
      }

      // 4. ZMIANA SYGNAŁU (+ SMA150 check)
      if (pos.signal && pos.signal !== 'TEST'
          && pnlPct < targetFrac * 0.9
          && pnlPct > -(stopPct * 0.8)) {
        const candleData = await fetchCandles(pos.ticker, exchange).catch(() => null)
        const candles    = candleData?.candles
        if (candles && !checkSignalStillValid(pos.signal, candles, pos.strategy)) {
          if (!(await dedup('signal-change', 48))) {
            const detail = signalExpiredText(pos.signal, candles)
            await sendTelegram(
              `🔄 <b>ZMIANA SYGNAŁU — ${ticker}</b>\n\nSygnał <b>${pos.signal}</b> który otworzył pozycję wygasł.\n${detail}\n\nP&L: ${(pnlPct * 100).toFixed(1)}% | Cel: +${pos.target}% | Stop: -${pos.stopLoss}%\n\n${WHAT_TO_DO.signalChange()}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
              IS_STAGING
            )
            alertsSent++
          }
        }

        // 5. MACD NIEDŹWIEDZIE (swing + aggressive)
        if (candles && ['swing', 'aggressive'].includes(pos.strategy)) {
          if (checkMACDBearish(candles)) {
            if (!(await dedup('macd-bearish', 48))) {
              await sendTelegram(
                `📉 <b>MACD ODWRÓCENIE — ${ticker}</b>\n\nMACD przeszedł na niedźwiedzie skrzyżowanie.\nP&L: ${(pnlPct * 100).toFixed(1)}% | Cena: ${price} ${currency}\n\n${WHAT_TO_DO.macdBearish()}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
                IS_STAGING
              )
              alertsSent++
            }
          }
        }
      }

      // 6. TREND INDEKSU ODWRÓCONY (swing + aggressive)
      if (['swing', 'aggressive'].includes(pos.strategy)) {
        const indexTrend = await fetchIndexTrend(exchange).catch(() => 'neutral')
        if (indexTrend === 'down') {
          if (!(await dedup('index-down', 48))) {
            const indexName = exchange === 'NYSE' ? 'SPY (S&P500)' : 'WIG20'
            await sendTelegram(
              `⚠️ <b>TREND INDEKSU SPADKOWY — ${ticker}</b>\n\n${indexName} jest w trendzie spadkowym.\nP&L: ${(pnlPct * 100).toFixed(1)}% | Cena: ${price} ${currency}\n\n${WHAT_TO_DO.indexDown()}\n\n📱 <a href="https://gpw-analyzer.vercel.app">Otwórz Moje wyniki</a>`,
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
