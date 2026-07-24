/** Date and money helpers shared by the USD and EUR cashflows. UTC-only, no deps. */
export const pad = (n) => String(n).padStart(2, '0')
export const toISO = (d) => d.toISOString().slice(0, 10)
export const todayISO = () => toISO(new Date())
export const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
export const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d) }
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const addMonths = (s, n) => {
  const d = toUTC(s); const day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n)
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)))
  return toISO(d)
}
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000)
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
export const domIn = (s, dom) => {
  const y = +s.slice(0, 4), m = +s.slice(5, 7)
  return `${y}-${pad(m)}-${pad(Math.min(dom, daysInMonth(y, m)))}`
}
export const monthStartOf = (s) => `${s.slice(0, 7)}-01`
export const endOfMonth = (s) => domIn(s, 31)
export const round2 = (n) => Math.round(n * 100) / 100
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (s) => `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`
export const monthLabel = (s) => `${MONTHS[+s.slice(5, 7) - 1]} ’${s.slice(2, 4)}`
export const monthName = (s) => `${['January','February','March','April','May','June','July','August','September','October','November','December'][+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const weekday = (s) => WD[toUTC(s).getUTCDay()]
