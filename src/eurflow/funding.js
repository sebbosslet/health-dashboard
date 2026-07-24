import { addDays, addMonths, cmp, domIn, monthStartOf, round2 } from '../cashflow/dates'

/**
 * The EUR account has no income of its own — it is funded from USD.
 *
 * Rule: never let the balance fall below `minBalance`, and move money at most
 * once per calendar month. Each month gets exactly one funding opportunity
 * (the preferred funding day, or today if that day has already passed this
 * month). For each window between opportunities we look at the worst balance
 * that window would reach, and transfer just enough — rounded up — to keep the
 * floor intact until the next opportunity.
 */

export function expandEurRule(rule, from, to) {
  if (!rule.active) return []
  const out = []
  const dom = Number(rule.dueDay) || 1
  let cursor = rule.startDate && cmp(rule.startDate, from) > 0 ? rule.startDate : from
  let cand = domIn(cursor, dom)
  if (cmp(cand, cursor) < 0) cand = domIn(addMonths(monthStartOf(cursor), 1), dom)
  while (cmp(cand, to) <= 0) {
    if ((!rule.startDate || cmp(cand, rule.startDate) >= 0) && (!rule.endDate || cmp(cand, rule.endDate) <= 0)) out.push(cand)
    cand = domIn(addMonths(monthStartOf(cand), 1), dom)
  }
  return out
}

/** Every EUR event except funding: fixed payments and one-offs. */
export function eurEvents(doc, from, to) {
  const events = []
  for (const r of doc.rules || []) {
    for (const d of expandEurRule(r, from, to)) {
      events.push({ date: d, amount: -Math.abs(Number(r.amount) || 0), description: r.name, type: 'fixed', ruleId: r.id })
    }
  }
  for (const t of doc.transactions || []) {
    if (t.skipped) continue
    if (cmp(t.date, from) < 0 || cmp(t.date, to) > 0) continue
    events.push({ date: t.date, amount: Number(t.amount), description: t.description || 'One-off', type: t.type || 'oneoff', ledgerId: t.id, status: t.status })
  }
  return events.sort((a, b) => cmp(a.date, b.date))
}

/** One funding opportunity per calendar month, never in the past. */
function fundingDates(today, horizonEnd, fundingDay) {
  const dates = []
  let month = monthStartOf(today)
  while (cmp(month, horizonEnd) <= 0) {
    let d = domIn(month, fundingDay)
    if (cmp(d, today) < 0) d = today            // this month's chance has passed — act now
    if (cmp(d, horizonEnd) <= 0) dates.push(d)
    month = addMonths(month, 1)
  }
  return [...new Set(dates)]
}

const ceilTo = (n, step) => (step > 0 ? Math.ceil(n / step) * step : round2(n))

/**
 * The rate that actually costs you dollars: the mid-market reference plus
 * whatever your transfer provider takes. Wise is typically 0.4–0.6%; a bank
 * wire is more like 2–3%. Modelling the spread keeps the USD forecast honest
 * rather than optimistic.
 */
export function effectiveFxRate(f = {}) {
  const mid = f.fxMode === 'manual'
    ? Number(f.fxManual ?? f.fxRate ?? 1.08)
    : Number(f.fxLiveRate ?? f.fxRate ?? 1.08)
  const spread = Number(f.fxSpreadPct ?? 0) / 100
  return Math.round(mid * (1 + spread) * 10000) / 10000
}

/**
 * The rate to assume for a transfer some years out.
 *
 * Default drift is zero, and that is a deliberate choice rather than laziness:
 * for major currency pairs today's spot has repeatedly proven as good a
 * predictor of future spot as any model. Drift exists here for stress-testing
 * — "what if the dollar weakens 3% a year" — not for prediction.
 */
export function fxRateOn(f, today, date) {
  const base = effectiveFxRate(f)
  const drift = Number(f.fxDriftPct ?? 0) / 100
  if (!drift) return base
  const years = (Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / (365.25 * 86400000)
  return Math.round(base * Math.pow(1 + drift, years) * 10000) / 10000
}

export function computeFunding(doc, today, horizonEnd) {
  const f = { minBalance: 0, fundingDay: 1, roundTo: 50, fxRate: 1.08,
    fxMode: 'live', fxSpreadPct: 0.5, ...(doc.funding || {}) }
  const rate = effectiveFxRate(f)
  const anchor = doc.anchor || { date: today, balance: 0 }
  const from = cmp(anchor.date, today) < 0 ? anchor.date : today
  const events = eurEvents(doc, from, horizonEnd)

  // balance on each day with no funding at all
  const byDate = new Map()
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) || []), e])
  const base = []
  let bal = Number(anchor.balance) || 0
  for (let d = from; cmp(d, horizonEnd) <= 0; d = addDays(d, 1)) {
    const evs = byDate.get(d) || []
    bal = round2(bal + evs.reduce((s, e) => s + e.amount, 0))
    base.push({ date: d, events: evs, unfunded: bal })
  }

  // one transfer per month, sized to hold the floor until the next one
  const opportunities = fundingDates(today, horizonEnd, Number(f.fundingDay) || 1)
  const transfers = []
  let carry = 0
  for (let i = 0; i < opportunities.length; i++) {
    const start = opportunities[i]
    const end = i + 1 < opportunities.length ? addDays(opportunities[i + 1], -1) : horizonEnd
    const window = base.filter((d) => cmp(d.date, start) >= 0 && cmp(d.date, end) <= 0)
    if (!window.length) continue
    const worst = Math.min(...window.map((d) => d.unfunded)) + carry
    if (worst < f.minBalance) {
      const amountEur = ceilTo(f.minBalance - worst, Number(f.roundTo) || 0)
      const rateThen = fxRateOn(f, today, start)
      transfers.push({
        date: start,
        amountEur: round2(amountEur),
        amountUsd: round2(amountEur * rateThen),
        rate: rateThen,
        reason: round2(worst),
      })
      carry = round2(carry + amountEur)
    }
  }

  // final projection with funding applied
  const transferOn = new Map(transfers.map((t) => [t.date, t]))
  let running = 0
  const days = base.map((d) => {
    const t = transferOn.get(d.date)
    if (t) running = round2(running + t.amountEur)
    const balance = round2(d.unfunded + running)
    return {
      date: d.date,
      events: t ? [{ date: d.date, amount: t.amountEur, description: 'Funding from USD', type: 'funding' }, ...d.events] : d.events,
      balance,
      belowFloor: balance < f.minBalance,
    }
  })

  const min = days.reduce((a, b) => (b.balance < a.balance ? b : a), days[0] || { balance: 0, date: today })
  return { days, transfers, settings: f, rate, minBalance: min.balance, minDate: min.date }
}
