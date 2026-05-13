import { useEffect, useState } from 'react'
import GEMDecisionCard from './GEMDecisionCard.jsx'
import GEMStepsCard    from './GEMStepsCard.jsx'
import GEMHistory      from './GEMHistory.jsx'
import GEMSimulator    from './GEMSimulator.jsx'
import GEMPortfolio    from './GEMPortfolio.jsx'

export default function GEMPage() {
  const [decision, setDecision] = useState(null)
  const [history,  setHistory]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/market?mode=gem-decision').then(r => r.ok ? r.json() : null),
      fetch('/api/market?mode=gem-history').then(r => r.ok ? r.json() : null),
    ]).then(([decRes, histRes]) => {
      if (decRes.status === 'fulfilled' && decRes.value) setDecision(decRes.value)
      if (histRes.status === 'fulfilled' && Array.isArray(histRes.value)) setHistory(histRes.value)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 bg-gpw-card border border-gpw-border rounded-lg" />
        <div className="h-24 bg-gpw-card border border-gpw-border rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GEMDecisionCard decision={decision} />
        <GEMStepsCard decision={decision} />
      </div>

      <GEMPortfolio decision={decision} />
      <GEMSimulator />
      <GEMHistory history={history} />

      <div className="text-xs text-gray-600 leading-relaxed border-t border-gpw-border pt-3">
        <strong className="text-gray-500">O strategii GEM:</strong> Global Equities Momentum (Gary Antonacci) — co miesiąc wybiera między akcjami USA (CSPX), akcjami świata (SWRD) a obligacjami globalnymi (AGGH) na podstawie momentum 12-miesięcznego. Szczegóły w książce <em>Dual Momentum Investing</em>.
      </div>
    </div>
  )
}
