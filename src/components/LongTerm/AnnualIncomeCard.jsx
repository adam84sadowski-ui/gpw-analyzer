import { useState, useEffect } from 'react'
import { useExchange } from '../../context/ExchangeContext.jsx'

export default function AnnualIncomeCard() {
  const { exchange } = useExchange()
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const currency = exchange === 'NYSE' ? 'USD' : 'PLN'

  useEffect(() => {
    setLoading(true)
    setItems([])

    fetch('/api/positions?status=open')
      .then(r => r.json())
      .then(async positions => {
        const relevant = positions.filter(p => (p.exchange ?? 'GPW') === exchange)
        const results  = await Promise.all(
          relevant.map(async pos => {
            const fund = await fetch(`/api/market?mode=fundamentals&ticker=${pos.ticker}&exchange=${pos.exchange ?? exchange}`)
              .then(r => r.json())
              .catch(() => null)
            if (!fund?.dividendYield || fund.dividendYield <= 0) return null
            return {
              ticker:        pos.ticker.replace('.pl', '').toUpperCase(),
              positionSize:  pos.positionSize,
              dividendYield: fund.dividendYield,
              annual:        Math.round(pos.positionSize * fund.dividendYield),
            }
          })
        )
        setItems(results.filter(Boolean))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [exchange])

  const total = items.reduce((s, i) => s + i.annual, 0)

  if (loading) {
    return (
      <div className="bg-gpw-card border border-gpw-border rounded-xl p-4 text-gray-400 text-sm">
        Ładowanie danych dywidendowych…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-gpw-card border border-gpw-border rounded-xl p-4 text-gray-500 text-sm text-center">
        Brak otwartych pozycji z danymi o dywidendzie dla {exchange}.
      </div>
    )
  }

  return (
    <div className="bg-gpw-card border border-gpw-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">💵 Roczna dywidenda z portfela</h3>
        <span className="text-xs text-gray-500">{exchange}</span>
      </div>
      <div className="text-2xl font-bold text-gpw-green">
        ~{total.toLocaleString('pl-PL')} {currency}<span className="text-sm font-normal text-gray-400">/rok</span>
      </div>
      <div className="space-y-2">
        {items.map(i => (
          <div key={i.ticker} className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-200 w-16">{i.ticker}</span>
            <span className="text-gray-400">{(i.dividendYield * 100).toFixed(1)}% yield</span>
            <span className="text-gray-400">× {i.positionSize.toLocaleString('pl-PL')} {currency}</span>
            <span className="font-semibold text-gpw-green">~{i.annual.toLocaleString('pl-PL')} {currency}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-600">Szacunek na podstawie bieżącego yield. Nie uwzględnia podatku i zmian kursu.</p>
    </div>
  )
}
