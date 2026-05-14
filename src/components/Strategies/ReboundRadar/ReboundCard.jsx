import { useState } from 'react'
import { TIERS } from '../../../indicators/reboundRadar.js'
import EntryValidationModal from './EntryValidationModal.jsx'

export default function ReboundCard({ item, tier, strategy, exchange, onOpenPosition }) {
  const [showModal, setShowModal] = useState(false)
  const currency = exchange === 'NYSE' ? 'USD' : 'PLN'
  const t = TIERS[tier]
  const canValidate = tier === 'green'

  return (
    <>
      <div
        className={`bg-gpw-card border ${t.borderColor} rounded-lg p-3 space-y-2 ${canValidate ? 'cursor-pointer hover:bg-white/5 active:scale-[0.98] transition-all' : ''}`}
        onClick={() => canValidate && setShowModal(true)}
      >
        <div className="flex justify-between items-start">
          <div>
            <span className="font-bold text-sm">{item.tickerDisplay}</span>
            {item.companyName && (
              <span className="text-xs text-gray-500 ml-1 truncate max-w-[100px] inline-block align-bottom">
                ({item.companyName})
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400 font-semibold">{item.price} {currency}</span>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {item.rsi != null && (
            <span className={`px-1.5 py-0.5 rounded font-bold ${
              item.rsi < 30 ? 'bg-gpw-green text-white'
              : item.rsi < 40 ? 'bg-yellow-700 text-white'
              : 'bg-gpw-border text-gray-300'
            }`}>
              RSI {item.rsi.toFixed(1)}
            </span>
          )}
          {item.score != null && (
            <span className={`px-1.5 py-0.5 rounded font-bold ${
              item.score >= 70 ? 'bg-gpw-blue text-white'
              : item.score >= 50 ? 'bg-gpw-border text-gray-200'
              : 'bg-gpw-border text-gray-500'
            }`}>
              {item.score}/100
            </span>
          )}
          {item.volMult != null && item.volMult >= 1.5 && (
            <span className="px-1.5 py-0.5 rounded bg-gpw-border text-gray-300">
              {item.volMult}x
            </span>
          )}
        </div>

        {item.signal && (
          <div className="text-xs text-gray-500">{item.signal}</div>
        )}

        {canValidate && (
          <div className={`text-xs font-semibold ${t.textColor} text-right`}>
            Dotknij → walidacja AI →
          </div>
        )}
      </div>

      {showModal && (
        <EntryValidationModal
          rec={item}
          strategy={strategy}
          exchange={exchange}
          onOpenPosition={onOpenPosition}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
