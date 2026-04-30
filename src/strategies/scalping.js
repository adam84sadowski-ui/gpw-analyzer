import { calcRSI } from '../indicators/rsi.js'
import { volumeMultiplier } from '../indicators/volume.js'

export const SCALPING_DEFAULTS = {
  rsiThreshold: 30,
  volumeMultiplierMin: 2,
  targetPct: 5,
  stopLossPct: 3,
  maxAlertsPerDay: 3,
  universe: ['pkn.pl', 'kghm.pl', 'pko.pl', 'pzu.pl', 'cdr.pl', 'ale.pl', 'mbk.pl', 'lpp.pl', 'pge.pl', 'jsw.pl'],
}

export function scalpingSignal(candles, thresholds = {}) {
  const { rsiThreshold = SCALPING_DEFAULTS.rsiThreshold, volumeMultiplierMin = SCALPING_DEFAULTS.volumeMultiplierMin } = thresholds
  if (candles.length < 20) return null

  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const rsi = calcRSI(closes)
  const volMult = volumeMultiplier(volumes)

  if (rsi !== null && rsi < rsiThreshold && volMult && volMult >= volumeMultiplierMin) {
    return {
      type: 'scalping',
      ticker: null,
      price: closes[closes.length - 1],
      signal: 'RSI_OVERSOLD',
      rsi,
      volumeMultiplier: volMult,
      target: SCALPING_DEFAULTS.targetPct,
      stopLoss: SCALPING_DEFAULTS.stopLossPct,
    }
  }
  return null
}
