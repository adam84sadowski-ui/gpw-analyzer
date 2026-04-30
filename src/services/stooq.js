export async function fetchIndex(ticker) {
  const res = await fetch(`/api/stooq?ticker=${encodeURIComponent(ticker)}&type=index`)
  if (!res.ok) throw new Error(`Stooq index error: ${res.status}`)
  return res.json()
}

export async function fetchDaily(ticker) {
  const res = await fetch(`/api/stooq?ticker=${encodeURIComponent(ticker)}&type=daily`)
  if (!res.ok) throw new Error(`Stooq daily error: ${res.status}`)
  return res.json()
}

export async function fetchCurrent(ticker) {
  const res = await fetch(`/api/stooq?ticker=${encodeURIComponent(ticker)}&type=current`)
  if (!res.ok) throw new Error(`Stooq current error: ${res.status}`)
  return res.json()
}
