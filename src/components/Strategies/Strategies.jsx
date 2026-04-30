import { useState, useEffect } from 'react'
import { SCALPING_DEFAULTS } from '../../strategies/scalping.js'
import { SWING_DEFAULTS } from '../../strategies/swing.js'
import { AGGRESSIVE_DEFAULTS } from '../../strategies/aggressive.js'

const STRATEGY_META = {
  scalping:   { label: '⚡ Scalping',   color: 'text-yellow-400', defaults: SCALPING_DEFAULTS,   target: '3-7%',   time: '2-5 dni' },
  swing:      { label: '📈 Swing',      color: 'text-blue-400',   defaults: SWING_DEFAULTS,      target: '10-20%', time: '4-8 tyg.' },
  aggressive: { label: '🚀 Agresywna',  color: 'text-red-400',    defaults: AGGRESSIVE_DEFAULTS, target: '20-50%', time: 'N/A' },
}

export default function Strategies() {
  const [active, setActive] = useState(
    () => localStorage.getItem('gpw_strategy') ?? 'swing'
  )

  useEffect(() => {
    localStorage.setItem('gpw_strategy', active)
  }, [active])

  return (
    <div className="space-y-4">
      {Object.entries(STRATEGY_META).map(([key, meta]) => (
        <div
          key={key}
          className={`bg-gpw-card border rounded-lg p-5 cursor-pointer transition-all ${
            active === key ? 'border-gpw-blue' : 'border-gpw-border hover:border-gray-500'
          }`}
          onClick={() => setActive(key)}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`font-semibold text-lg ${meta.color}`}>{meta.label}</span>
            {active === key && <span className="text-xs bg-gpw-blue text-white px-2 py-0.5 rounded">AKTYWNA</span>}
          </div>
          <div className="text-sm text-gray-400 grid grid-cols-2 gap-2">
            <div>Cel: <span className="text-white">{meta.target}</span></div>
            <div>Horyzont: <span className="text-white">{meta.time}</span></div>
            <div>Stop loss: <span className="text-gpw-red">-{meta.defaults.stopLossPct}%</span></div>
            <div>Max alertów: <span className="text-white">{meta.defaults.maxAlertsPerDay}/dzień</span></div>
          </div>
          {key === 'scalping' && (
            <div className="mt-3 text-xs text-gray-500">
              RSI próg: {meta.defaults.rsiThreshold} | Wolumen: {meta.defaults.volumeMultiplierMin}x
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
