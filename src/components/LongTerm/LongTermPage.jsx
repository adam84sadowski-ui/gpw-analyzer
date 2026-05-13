import { useState } from 'react'
import GEMPage        from './GEM/GEMPage.jsx'
import DividendSignals from './DividendSignals.jsx'
import DividendCalendar from './DividendCalendar.jsx'
import DCAConfigForm from './DCAConfigForm.jsx'
import ETFPortfolio from './ETFPortfolio.jsx'
import AnnualIncomeCard from './AnnualIncomeCard.jsx'

const SUB_TABS = [
  { id: 'gem',      label: '🌍 GEM' },
  { id: 'dca',      label: '📅 ETF / DCA' },
  { id: 'dividend', label: '💰 Dywidendowe' },
]

export default function LongTermPage() {
  const [sub, setSub] = useState('gem')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gpw-border pb-0">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              sub === t.id
                ? 'border-gpw-blue text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'gem' && <GEMPage />}

      {sub === 'dca' && (
        <div className="max-w-2xl space-y-6">
          <ETFPortfolio />
          <DCAConfigForm />
        </div>
      )}

      {sub === 'dividend' && (
        <div className="space-y-6">
          <AnnualIncomeCard />
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">📊 Sygnały dywidendowe</h2>
            <DividendSignals />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">📅 Kalendarz dywidend (30 dni)</h2>
            <DividendCalendar />
          </div>
        </div>
      )}
    </div>
  )
}
