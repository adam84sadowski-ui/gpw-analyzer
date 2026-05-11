/**
 * Pure trailing stop computation — extracted from positions-monitor.js
 * for testability. No side effects, no KV, no Telegram.
 *
 * @param {number} entryPrice
 * @param {number} currentPrice
 * @param {number} highWaterMark  highest price seen since entry
 * @param {number} stopPct        stop loss as fraction (e.g. 0.05 for 5%)
 * @param {number} targetPct      target as fraction (e.g. 0.15 for 15%)
 * @returns {object|null}         null when currentPrice <= highWaterMark (no update needed)
 */
export function calcTrailingStop(entryPrice, currentPrice, highWaterMark, stopPct, targetPct) {
  if (currentPrice <= highWaterMark) return null

  const newHWM        = currentPrice
  const trailingStop  = Math.round(newHWM * (1 - stopPct) * 100) / 100
  const pnlFrac       = (currentPrice - entryPrice) / entryPrice
  const breakEven     = pnlFrac >= targetPct * 0.5 ? entryPrice : null
  const effectiveStop = breakEven != null ? Math.max(trailingStop, breakEven) : trailingStop

  return { newHWM, trailingStop, effectiveStop, breakEven }
}
