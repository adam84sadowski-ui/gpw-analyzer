import { useState, useEffect } from 'react'

const DEFAULTS = {
  capital: 10000,
  maxPositionPct: 15,
  strategy: 'swing',
  customTickers: '',
}

export default function Settings() {
  const [settings, setSettings] = useState(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('gpw_settings') ?? '{}') } }
    catch { return DEFAULTS }
  })
  const [saved, setSaved] = useState(false)

  function save() {
    localStorage.setItem('gpw_settings', JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function set(key, value) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-5 space-y-4">
        <h2 className="font-semibold">Portfel</h2>
        <label className="block">
          <span className="text-sm text-gray-400">Kapitał (PLN)</span>
          <input
            type="number"
            value={settings.capital}
            onChange={e => set('capital', Number(e.target.value))}
            className="mt-1 block w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm text-gray-400">Max pozycja (%): {settings.maxPositionPct}%</span>
          <input
            type="range"
            min="5" max="30" step="5"
            value={settings.maxPositionPct}
            onChange={e => set('maxPositionPct', Number(e.target.value))}
            className="mt-1 block w-full"
          />
        </label>
      </div>

      <div className="bg-gpw-card border border-gpw-border rounded-lg p-5 space-y-4">
        <h2 className="font-semibold">Własne tickery (opcjonalnie)</h2>
        <label className="block">
          <span className="text-sm text-gray-400">Tickery oddzielone przecinkiem (np. pkn.pl, kghm.pl)</span>
          <input
            type="text"
            value={settings.customTickers}
            onChange={e => set('customTickers', e.target.value)}
            placeholder="pkn.pl, kghm.pl"
            className="mt-1 block w-full bg-gpw-dark border border-gpw-border rounded px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="bg-gpw-card border border-gpw-border rounded-lg p-5 space-y-4">
        <h2 className="font-semibold">Klucze API</h2>
        <p className="text-xs text-gray-400">
          Klucze API ustaw jako zmienne środowiskowe w Vercel dashboard. Nigdy nie wpisuj ich tutaj.
        </p>
        <div className="text-xs text-gray-500">
          Środowisko: <span className="text-white">
            {import.meta.env.VITE_ENV === 'staging' ? '🟣 STAGING' : '🔵 PROD'}
          </span>
        </div>
      </div>

      <button
        onClick={save}
        className="bg-gpw-blue hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm transition-colors"
      >
        {saved ? '✅ Zapisano' : 'Zapisz ustawienia'}
      </button>
    </div>
  )
}
