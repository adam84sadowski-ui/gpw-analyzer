export default function Results() {
  return (
    <div className="space-y-4">
      <div className="bg-gpw-card border border-gpw-border rounded-lg p-6">
        <h2 className="font-semibold mb-4">Skuteczność strategii</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          {['Scalping', 'Swing', 'Agresywna'].map(s => (
            <div key={s} className="bg-gpw-dark rounded-lg p-4">
              <div className="text-2xl font-bold text-gray-500">—</div>
              <div className="text-xs text-gray-400 mt-1">{s}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-4 text-center">
          Wyniki pojawią się po pierwszych alertach i ich rozliczeniu.
        </p>
      </div>

      <div className="bg-gpw-card border border-gpw-border rounded-lg p-6">
        <h2 className="font-semibold mb-2">Symulacja kapitału</h2>
        <p className="text-sm text-gray-400">
          Wykres symulacji portfela pojawi się po zgromadzeniu historii sygnałów.
        </p>
      </div>
    </div>
  )
}
