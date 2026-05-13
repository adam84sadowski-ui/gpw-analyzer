export default function GEMStepsCard({ decision }) {
  if (!decision) return null

  const cspxPct  = decision.cspx12m != null ? `${(decision.cspx12m * 100).toFixed(1)}%` : '—'
  const swrdPct  = decision.swrd12m != null ? `${(decision.swrd12m * 100).toFixed(1)}%` : '—'
  const cashPct  = decision.cashRate != null ? `${(decision.cashRate * 100).toFixed(1)}%` : '—'
  const lookback = decision.lookback ?? 12

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-lg p-4 space-y-4">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Szczegóły algorytmu</div>

      {/* Step 1 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-200">Krok 1 — Trend rynku</span>
          <span className={`text-sm font-bold ${decision.step1Passed ? 'text-green-400' : 'text-red-400'}`}>
            {decision.step1Passed ? '✅ OK' : '❌ SŁABY'}
          </span>
        </div>
        <div className="text-xs text-gray-400 pl-1 space-y-0.5">
          <div>CSPX {lookback}m: <span className={`font-medium ${decision.cspx12m >= 0 ? 'text-green-400' : 'text-red-400'}`}>{cspxPct}</span></div>
          <div>Gotówka: <span className="font-medium text-gray-300">{cashPct}</span></div>
          <div className="text-gray-500 italic">
            {decision.step1Passed ? 'Rynek w trendzie wzrostowym' : 'Rynek poniżej stopy gotówkowej — ochrona kapitału'}
          </div>
        </div>
      </div>

      {/* Step 2 */}
      {decision.step1Passed && (
        <div className="space-y-1 border-t border-gpw-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-200">Krok 2 — Który rynek</span>
            <span className={`text-sm font-bold ${decision.decision === 'world' ? 'text-green-400' : 'text-blue-400'}`}>
              {decision.decision === 'world' ? '🌍 ŚWIAT' : '🇺🇸 USA'}
            </span>
          </div>
          <div className="text-xs text-gray-400 pl-1 space-y-0.5">
            <div>SWRD {lookback}m: <span className={`font-medium ${decision.swrd12m >= 0 ? 'text-green-400' : 'text-red-400'}`}>{swrdPct}</span></div>
            <div>CSPX {lookback}m: <span className={`font-medium ${decision.cspx12m >= 0 ? 'text-green-400' : 'text-red-400'}`}>{cspxPct}</span></div>
            <div className="text-gray-500 italic">
              {decision.decision === 'world' ? 'Świat silniejszy od USA' : 'USA silniejsze od reszty świata'}
            </div>
          </div>
        </div>
      )}

      {/* Bonds mode */}
      {!decision.step1Passed && (
        <div className="border-t border-gpw-border pt-3 text-xs text-yellow-400">
          🛡️ Krok 2 pominięty — cały portfel GEM w obligacjach (AGGH)
        </div>
      )}
    </div>
  )
}
