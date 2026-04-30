import { useState, useRef, useEffect } from 'react'

export default function Chat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Cześć! Jestem asystentem GPW Analyzer. Możesz mnie zapytać o alerty, strategie lub wyniki portfela.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const data = await res.json()
      setMessages(m => [...m, { role: 'assistant', content: data.content }])
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Błąd połączenia z API. Sprawdź klucz ANTHROPIC_API_KEY.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gpw-blue rounded-full shadow-lg flex items-center justify-center text-2xl z-50"
        aria-label="Otwórz chat"
      >
        💬
      </button>

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-24 right-6 w-80 h-96 bg-gpw-card border border-gpw-border rounded-xl shadow-2xl flex flex-col z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gpw-border">
            <span className="font-semibold text-sm">GPW Asystent</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div key={i} className={`text-sm rounded-lg px-3 py-2 max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-gpw-blue ml-auto'
                  : 'bg-gpw-dark'
              }`}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="text-sm bg-gpw-dark rounded-lg px-3 py-2 w-16 text-gray-400">…</div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-3 border-t border-gpw-border flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Zapytaj o alerty…"
              className="flex-1 bg-gpw-dark border border-gpw-border rounded px-3 py-1.5 text-sm"
            />
            <button
              onClick={send}
              disabled={loading}
              className="bg-gpw-blue px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              →
            </button>
          </div>
        </div>
      )}
    </>
  )
}
