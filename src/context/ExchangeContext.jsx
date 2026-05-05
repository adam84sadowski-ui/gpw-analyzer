import { createContext, useContext, useState } from 'react'

const ExchangeContext = createContext(null)

const EXCHANGE_META = {
  GPW:  { currency: 'PLN', timezone: 'Europe/Warsaw',    flag: '🇵🇱', label: 'GPW' },
  NYSE: { currency: 'USD', timezone: 'America/New_York', flag: '🇺🇸', label: 'NYSE' },
}

export function ExchangeProvider({ children }) {
  const [exchange, setExchange] = useState(
    () => localStorage.getItem('gpw_exchange') ?? 'GPW'
  )

  function switchExchange(ex) {
    setExchange(ex)
    localStorage.setItem('gpw_exchange', ex)
  }

  return (
    <ExchangeContext.Provider value={{ exchange, switchExchange, ...EXCHANGE_META[exchange] }}>
      {children}
    </ExchangeContext.Provider>
  )
}

export function useExchange() {
  return useContext(ExchangeContext)
}
