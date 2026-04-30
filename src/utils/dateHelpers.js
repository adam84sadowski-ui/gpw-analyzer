export function isWeekday(date = new Date()) {
  const day = date.getDay()
  return day > 0 && day < 6
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
