// Max 10 of 20 free daily requests — called once at 17:30
export async function fetchFundamentals(ticker) {
  const key = import.meta.env.VITE_ENV === 'staging'
    ? null
    : process.env.EODHD_API_KEY

  if (!key) return null

  // ticker e.g. "PKN.WAR"
  const url = `https://eodhd.com/api/fundamentals/${ticker}?api_token=${key}&fmt=json&filter=Highlights::PERatio,Highlights::DividendYield`
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json()
}
