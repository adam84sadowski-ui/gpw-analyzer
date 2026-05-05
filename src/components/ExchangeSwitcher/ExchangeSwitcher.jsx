import { useExchange } from '../../context/ExchangeContext.jsx'

export default function ExchangeSwitcher() {
  const { exchange, switchExchange } = useExchange()

  return (
    <div className="flex border border-gpw-border rounded-lg overflow-hidden text-xs">
      {['GPW', 'NYSE'].map(ex => (
        <button
          key={ex}
          onClick={() => switchExchange(ex)}
          className={`px-3 py-1.5 transition-colors ${
            exchange === ex ? 'bg-gpw-blue text-white' : 'bg-gpw-dark text-gray-400 hover:text-white'
          }`}
        >
          {ex === 'GPW' ? '🇵🇱 GPW' : '🇺🇸 NYSE'}
        </button>
      ))}
    </div>
  )
}
