import { calcSMA, calcSMASeries, goldenCross } from '../indicators/sma.js'
import { volumeMultiplier } from '../indicators/volume.js'

export const SWING_DEFAULTS = {
  targetPct: 15,
  stopLossPct: 5,
  maxAlertsPerDay: 1,
  universe: ['kru.pl','acp.pl','bdx.pl','car.pl','cln.pl','dom.pl','eat.pl','gpw.pl','ing.pl','ker.pl','opl.pl','vrg.pl','pcf.pl','brs.pl','mlp.pl'],
}

export function swingSignal(candles, thresholds = {}) {
  const { volumeMultiplierMin = 1.5 } = thresholds
  if (candles.length < 55) return null

  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)
  const sma50Series = calcSMASeries(closes, 50)
  const last = closes.length - 1

  const prevClose = closes[last - 1]
  const currClose = closes[last]
  const prevSMA50 = sma50Series[last - 1]
  const currSMA50 = sma50Series[last]

  const crossedAboveSMA50 = prevClose <= prevSMA50 && currClose > currSMA50
  const gc = goldenCross(closes)
  const volMult = volumeMultiplier(volumes)

  if ((crossedAboveSMA50 || gc) && volMult && volMult >= volumeMultiplierMin) {
    return {
      type: 'swing',
      ticker: null, // set by caller
      price: currClose,
      signal: crossedAboveSMA50 ? 'SMA50_CROSSOVER' : 'GOLDEN_CROSS',
      sma20: calcSMA(closes, 20),
      sma50: currSMA50,
      volumeMultiplier: volMult,
      target: SWING_DEFAULTS.targetPct,
      stopLoss: SWING_DEFAULTS.stopLossPct,
    }
  }
  return null
}
