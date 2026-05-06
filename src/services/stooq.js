export async function fetchIndex(ticker, exchange = 'GPW') {
  const res = await fetch(`/api/market?mode=index&ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`)
  if (!res.ok) throw new Error(`Market index error: ${res.status}`)
  return res.json()
}

export async function fetchDaily(ticker, exchange = 'GPW') {
  const res = await fetch(`/api/market?mode=daily&ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`)
  if (!res.ok) throw new Error(`Market daily error: ${res.status}`)
  return res.json()
}

export async function fetchCurrent(ticker, exchange = 'GPW') {
  const res = await fetch(`/api/market?mode=current&ticker=${encodeURIComponent(ticker)}&exchange=${exchange}`)
  if (!res.ok) throw new Error(`Market current error: ${res.status}`)
  return res.json()
}
