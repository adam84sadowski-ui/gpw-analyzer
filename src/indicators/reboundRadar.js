export function classifyStocks(scanData = []) {
  const green = [], yellow = [], red = []
  for (const item of scanData) {
    if (item.hasSignal)               green.push(item)
    else if ((item.score ?? 0) >= 50) yellow.push(item)
    else                              red.push(item)
  }
  return { green, yellow, red }
}

export const TIERS = {
  green:  { label: 'Sygnał',      emoji: '🟢', textColor: 'text-gpw-green',  borderColor: 'border-gpw-green/40',    bgColor: 'bg-gpw-green/10'  },
  yellow: { label: 'Obserwuj',    emoji: '🟡', textColor: 'text-yellow-400', borderColor: 'border-yellow-600/40',  bgColor: 'bg-yellow-900/10' },
  red:    { label: 'Za wcześnie', emoji: '🔴', textColor: 'text-gpw-red',    borderColor: 'border-gpw-red/30',     bgColor: 'bg-gpw-red/5'     },
}
