const ETF_COLOR = { CSPX: 'text-blue-400', SWRD: 'text-green-400', AGGH: 'text-yellow-400' }
const ETF_FLAG  = { CSPX: '🇺🇸', SWRD: '🌍', AGGH: '🛡️' }

export default function GEMHistory({ history }) {
  if (!history?.length) {
    return (
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-4">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">Historia decyzji GEM</div>
        <p className="text-sm text-gray-500">
          Brak historii — pojawi się po pierwszym przeglądzie miesięcznym.
        </p>
      </div>
    )
  }

  const sorted = [...history].sort((a, b) => b.month?.localeCompare(a.month ?? '') ?? 0)

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-3">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Historia decyzji GEM</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gpw-border">
              <th className="text-left pb-2 font-medium">Miesiąc</th>
              <th className="text-left pb-2 font-medium">ETF</th>
              <th className="text-right pb-2 font-medium">CSPX 12m</th>
              <th className="text-right pb-2 font-medium">SWRD 12m</th>
              <th className="text-right pb-2 font-medium">Gotówka</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gpw-border/50">
            {sorted.map((entry, i) => {
              const label   = entry.month ? new Date(entry.month + '-01').toLocaleDateString('pl-PL', { month: 'short', year: 'numeric' }) : '—'
              const color   = ETF_COLOR[entry.etf] ?? 'text-white'
              const flag    = ETF_FLAG[entry.etf]  ?? ''
              const cspxPct = entry.cspx12m != null ? `${(entry.cspx12m * 100).toFixed(1)}%` : '—'
              const swrdPct = entry.swrd12m != null ? `${(entry.swrd12m * 100).toFixed(1)}%` : '—'
              const cashPct = entry.cashRate != null ? `${(entry.cashRate * 100).toFixed(1)}%` : '—'
              return (
                <tr key={i} className="text-gray-300">
                  <td className="py-1.5 text-gray-400">{label}</td>
                  <td className={`py-1.5 font-semibold ${color}`}>{flag} {entry.etf}</td>
                  <td className={`py-1.5 text-right ${entry.cspx12m >= 0 ? 'text-green-400' : 'text-red-400'}`}>{cspxPct}</td>
                  <td className={`py-1.5 text-right ${entry.swrd12m != null ? (entry.swrd12m >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-500'}`}>{swrdPct}</td>
                  <td className="py-1.5 text-right text-gray-400">{cashPct}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
