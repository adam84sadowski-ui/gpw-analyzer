import { calcRSI } from '../indicators/rsi.js'
import { volumeMultiplier } from '../indicators/volume.js'
import { isBreakout, nearATH } from '../indicators/breakout.js'

export const AGGRESSIVE_DEFAULTS = {
  rsiMin: 60,
  volumeMultiplierMin: 2.0,
  targetPct: 35,
  stopLossPct: 8,
  maxAlertsPerDay: 2,
  universe: ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl'],
}

export function aggressiveSignal(candles, thresholds = {}) {
  const {
    rsiMin = AGGRESSIVE_DEFAULTS.rsiMin,
    volumeMultiplierMin = AGGRESSIVE_DEFAULTS.volumeMultiplierMin,
  } = thresholds

  if (candles.length < 25) return null

  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const rsi = calcRSI(closes)
  const volMult = volumeMultiplier(volumes)
  const breakout = isBreakout(candles)
  const ath = nearATH(candles)

  if (breakout && rsi && rsi > rsiMin && volMult && volMult >= volumeMultiplierMin) {
    return {
      type: 'aggressive',
      ticker: null,
      price: closes[closes.length - 1],
      signal: 'BREAKOUT',
      rsi,
      volumeMultiplier: volMult,
      nearATH: ath,
      target: AGGRESSIVE_DEFAULTS.targetPct,
      stopLoss: AGGRESSIVE_DEFAULTS.stopLossPct,
    }
  }
  return null
}
