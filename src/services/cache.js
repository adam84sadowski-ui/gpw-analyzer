export function kvGet(key) {
  return fetch(`/api/kv?key=${encodeURIComponent(key)}`).then(r => r.json())
}

export function kvSet(key, value, exSeconds) {
  return fetch('/api/kv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, ex: exSeconds }),
  }).then(r => r.json())
}
