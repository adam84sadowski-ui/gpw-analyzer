import { useMemo } from 'react'
import { classifyStocks } from '../../../indicators/reboundRadar.js'
import ReboundColumn from './ReboundColumn.jsx'

export default function ReboundRadarPage({ scanData, scanLoading, strategy, exchange, onOpenPosition }) {
  const { green, yellow, red } = useMemo(() => classifyStocks(scanData), [scanData])

  if (scanLoading) {
    return (
      <div className="text-gray-400 text-sm py-8 text-center animate-pulse">
        Ładowanie radaru…
      </div>
    )
  }

  if (scanData.length === 0) {
    return (
      <div className="bg-gpw-dark rounded-lg p-4 text-sm text-gray-400 text-center">
        Brak danych radaru — dane załadują się po pierwszym skanie.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500 px-1">
        🎯 Kliknij zieloną kartę aby zwalidować wejście z AI
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        <ReboundColumn tier="green"  items={green}  strategy={strategy} exchange={exchange} onOpenPosition={onOpenPosition} />
        <ReboundColumn tier="yellow" items={yellow} strategy={strategy} exchange={exchange} onOpenPosition={onOpenPosition} />
        <ReboundColumn tier="red"    items={red}    strategy={strategy} exchange={exchange} onOpenPosition={onOpenPosition} />
      </div>
      <p className="text-xs text-gray-600 text-center">
        🟢 Sygnał aktywny · 🟡 Score ≥ 50 · 🔴 Za wcześnie
      </p>
    </div>
  )
}
