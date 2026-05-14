import { TIERS } from '../../../indicators/reboundRadar.js'
import ReboundCard from './ReboundCard.jsx'

export default function ReboundColumn({ tier, items, strategy, exchange, onOpenPosition }) {
  const t = TIERS[tier]
  return (
    <div className={`flex-1 min-w-[160px] max-w-[240px] border ${t.borderColor} rounded-xl overflow-hidden`}>
      <div className={`${t.bgColor} border-b ${t.borderColor} px-3 py-2 flex items-center justify-between`}>
        <span className={`font-bold text-sm ${t.textColor}`}>{t.emoji} {t.label}</span>
        <span className="text-xs text-gray-500 bg-gpw-dark px-1.5 py-0.5 rounded">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="p-4 text-xs text-gray-500 text-center">Brak spółek</div>
      ) : (
        <div className="p-2 space-y-2 overflow-y-auto max-h-[60vh]">
          {items.map(item => (
            <ReboundCard
              key={item.ticker}
              item={item}
              tier={tier}
              strategy={strategy}
              exchange={exchange}
              onOpenPosition={onOpenPosition}
            />
          ))}
        </div>
      )}
    </div>
  )
}
