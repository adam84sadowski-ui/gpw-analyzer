import { useState } from 'react'
import { version as APP_VERSION } from '../package.json'
import Dashboard from './components/Dashboard/Dashboard.jsx'
import Strategies from './components/Strategies/Strategies.jsx'
import Alerts from './components/Alerts/Alerts.jsx'
import Results from './components/Results/Results.jsx'
import Settings from './components/Settings/Settings.jsx'
import Backtesting from './components/Backtesting/Backtesting.jsx'
import Chat from './components/Chat/Chat.jsx'
import { ExchangeProvider } from './context/ExchangeContext.jsx'
import ExchangeSwitcher from './components/ExchangeSwitcher/ExchangeSwitcher.jsx'

const TABS = [
  { id: 'dashboard',   label: '📊 Dashboard' },
  { id: 'strategies',  label: '⚡ Strategie' },
  { id: 'alerts',      label: '🔔 Historia alertów' },
  { id: 'results',     label: '📈 Moje wyniki' },
  { id: 'backtest',    label: '🔬 Backtest' },
  { id: 'settings',    label: '⚙️ Ustawienia' },
]

export default function App() {
  const [tab, setTab] = useState('dashboard')

  return (
    <ExchangeProvider>
      <div className="min-h-screen bg-gpw-dark text-white">
        <header className="bg-gpw-card border-b border-gpw-border px-4 py-3 flex items-center gap-3">
          <span className="text-xl font-bold">GPW Analyzer</span>
          <span className="text-xs text-gray-300 bg-gpw-dark px-2 py-0.5 rounded">
            {window.location.hostname !== 'gpw-analyzer.vercel.app' ? `🟣 STAGING v${APP_VERSION}` : `🔵 PROD v${APP_VERSION}`}
          </span>
          <div className="ml-auto">
            <ExchangeSwitcher />
          </div>
        </header>

        <nav className="bg-gpw-card border-b border-gpw-border px-4 flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-gpw-blue text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main className="p-4 max-w-7xl mx-auto">
          {tab === 'dashboard'  && <Dashboard />}
          {tab === 'strategies' && <Strategies />}
          {tab === 'alerts'     && <Alerts />}
          {tab === 'results'    && <Results />}
          {tab === 'backtest'   && <Backtesting />}
          {tab === 'settings'   && <Settings />}
        </main>

        <Chat />
      </div>
    </ExchangeProvider>
  )
}
