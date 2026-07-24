import { useEffect, useMemo, useRef, useState } from "react";
import { loadCashflow, saveCashflow } from "./store";
import "./cashflow.css";

/* ============================================================
   sebs.cashflow — personal cash-flow forecasting
   Screens: Dashboard · Cards · Recurring · Income · Ledger · Horizon
   ============================================================ */

/* ---------------- date helpers ---------------- */
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => d.toISOString().slice(0, 10);
const todayISO = () => toISO(new Date());
const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addMonths = (s, n) => {
  const d = toUTC(s); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)));
  return toISO(d);
};
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const domIn = (s, dom) => {
  const y = +s.slice(0, 4), m = +s.slice(5, 7);
  return `${y}-${pad(m)}-${pad(Math.min(dom, daysInMonth(y, m)))}`;
};
const nextDom = (s, dom) => {
  const t = domIn(s, dom);
  return cmp(t, s) > 0 ? t : domIn(addMonths(domIn(s, 1), 1), dom);
};
const endOfMonth = (s) => domIn(s, 31);
const round2 = (n) => Math.round(n * 100) / 100;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/* ---------------- formatting ---------------- */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n) => usd.format(n || 0);
const money0 = (n) => usd0.format(n || 0);
const signed = (n) => (n >= 0 ? `+${usd.format(n)}` : `−${usd.format(Math.abs(n))}`);
const compact = (n) => {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 100000) return `${s}${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${s}${(a / 1000).toFixed(1)}k`;
  return `${s}${Math.round(a)}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (s) => `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
const monthLabel = (s) => `${MONTHS[+s.slice(5, 7) - 1]} ’${s.slice(2, 4)}`;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (s) => WD[toUTC(s).getUTCDay()];
const monthName = (s) => `${["January","February","March","April","May","June","July","August","September","October","November","December"][+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;

/* ---------------- payroll model ----------------
   Mirrors the biweekly stub: 26 periods, single filer, Virginia.
   Pre-tax = 401(k) + Section 125 (HSA, medical, dental, vision).
   FICA base excludes Section 125 but includes 401(k) + imputed life.
------------------------------------------------- */
const FED_BRACKETS = [[12400, .10], [50400, .12], [105700, .22], [201775, .24], [256225, .32], [640600, .35], [Infinity, .37]];
const FED_STD = 16100;
const VA_BRACKETS = [[3000, .02], [5000, .03], [17000, .05], [Infinity, .0575]];
const VA_STD = 8750;
const PERIODS = 26;

function taxFromBrackets(taxable, brackets) {
  let tax = 0, prev = 0;
  for (const [cap, rate] of brackets) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
  }
  return Math.max(0, tax);
}

const perCheck = (monthly) => round2((Number(monthly) || 0) * 12 / PERIODS);
const perMonth = (check) => round2((Number(check) || 0) * PERIODS / 12);

function computePaycheck(annualSalary, p) {
  const n = (v) => Number(v) || 0;
  const regular = round2(n(annualSalary) / PERIODS);
  const stipend = perCheck(p.stipendMonthly);
  const gross = round2(regular + stipend);
  const k401 = round2(regular * n(p.k401Pct) / 100);          // pre-tax
  const roth = round2(regular * n(p.rothPct) / 100);           // post-tax, no tax shield
  const match = round2(regular * n(p.matchPct) / 100);         // employer, not in net pay
  const hsa = n(p.hsa), medical = n(p.medical), dental = n(p.dental), vision = n(p.vision);
  const sec125 = hsa + medical + dental + vision;
  const fedTaxable = round2(gross - k401 - sec125);
  const ficaBase = round2(gross - sec125 + n(p.imputedLife));
  const ss = round2(ficaBase * 0.062);
  const medicare = round2(ficaBase * 0.0145);
  const fedAnnualTaxable = Math.max(0, fedTaxable * PERIODS - FED_STD);
  const fed = round2(taxFromBrackets(fedAnnualTaxable, FED_BRACKETS) / PERIODS + n(p.extraFed));
  const vaAnnualTaxable = Math.max(0, fedTaxable * PERIODS - VA_STD);
  const state = round2(taxFromBrackets(vaAnnualTaxable, VA_BRACKETS) / PERIODS + n(p.extraState));
  const car = perCheck(p.carMonthly);
  const legal = n(p.legal), hospital = n(p.hospital), critical = n(p.critical), accident = n(p.accident);
  const postTax = roth + car + legal + hospital + critical + accident;
  const taxes = round2(fed + ss + medicare + state);
  const net = round2(gross - taxes - k401 - sec125 - postTax);
  return {
    annualSalary: n(annualSalary), regular, stipend, gross, k401, roth, match,
    hsa, medical, dental, vision, sec125: round2(sec125), fedTaxable, ficaBase,
    fed, ss, medicare, state, taxes, car, legal, hospital, critical, accident,
    postTax: round2(postTax), net, fedAnnualTaxable: round2(fedAnnualTaxable),
  };
}

const DEFAULT_PAYROLL = {
  stipendMonthly: 239.35, carMonthly: 551.16,
  k401Pct: 6, rothPct: 0, matchPct: 4,
  hsa: 155.77, medical: 38.07, dental: 5.31, vision: 3.23,
  legal: 7.85, hospital: 4.84, critical: 4.80, accident: 2.30,
  imputedLife: 8.39, extraFed: 60, extraState: 20,
};

// Older saves stored stipend/car as per-check figures — migrate to monthly.
function normalizePayroll(p = {}) {
  const out = { ...DEFAULT_PAYROLL, ...p };
  if (p.stipend != null && p.stipendMonthly == null) out.stipendMonthly = perMonth(p.stipend);
  if (p.car != null && p.carMonthly == null) out.carMonthly = perMonth(p.car);
  delete out.stipend; delete out.car;
  return out;
}

/* ---------------- engine: recurrence ---------------- */
function expandRule(rule, from, to) {
  if (!rule.active) return [];
  const ws = cmp(rule.startDate, from) > 0 ? rule.startDate : from;
  const we = rule.endDate && cmp(rule.endDate, to) < 0 ? rule.endDate : to;
  if (cmp(ws, we) > 0) return [];
  const out = [];
  const stepDays = (n) => {
    let cur = rule.startDate;
    while (cmp(cur, from) < 0) cur = addDays(cur, n);
    while (cmp(cur, we) <= 0) { if (cmp(cur, ws) >= 0) out.push(cur); cur = addDays(cur, n); }
  };
  const stepMonths = (n) => {
    const dom = rule.dueDay || +rule.startDate.slice(8, 10);
    let cursor = rule.startDate, cand = domIn(cursor, dom);
    if (cmp(cand, rule.startDate) < 0) { cursor = addMonths(cursor, n); cand = domIn(cursor, dom); }
    while (cmp(cand, we) <= 0) { if (cmp(cand, ws) >= 0) out.push(cand); cursor = addMonths(cursor, n); cand = domIn(cursor, dom); }
  };
  const f = rule.frequency;
  if (f === "weekly") stepDays(7);
  else if (f === "biweekly") stepDays(14);
  else if (f === "monthly") stepMonths(1);
  else if (f === "quarterly") stepMonths(3);
  else if (f === "yearly") stepMonths(12);
  return out;
}

const monthlyEquivalent = (r) => {
  const a = Number(r.amount) || 0;
  return r.frequency === "monthly" ? a : r.frequency === "biweekly" ? a * 26 / 12
    : r.frequency === "weekly" ? a * 52 / 12 : r.frequency === "quarterly" ? a / 3 : a / 12;
};

/* ---------------- engine: paychecks ---------------- */
function expandPaychecks(profiles, from, to) {
  if (!profiles.length) return [];
  const sorted = [...profiles].sort((a, b) => cmp(a.effectiveDate, b.effectiveDate));
  const anchor = sorted[0].anchorPayDate;
  const rem = ((daysBetween(anchor, from) % 14) + 14) % 14;
  let payday = rem === 0 ? from : addDays(from, 14 - rem);
  const out = [];
  while (cmp(payday, to) <= 0) {
    let active = null;
    for (const p of sorted) { if (cmp(p.effectiveDate, payday) <= 0) active = p; else break; }
    if (active) out.push({ date: payday, net: Number(active.netPaycheck) || 0 });
    payday = addDays(payday, 14);
  }
  return out;
}

/* ---------------- engine: card cycles ---------------- */
function currentCycle(card, today) {
  let close = domIn(today, card.cycleCloseDay);
  if (cmp(close, today) < 0) close = domIn(addMonths(domIn(today, 1), 1), card.cycleCloseDay);
  const prevClose = domIn(addMonths(domIn(close, 1), -1), card.cycleCloseDay);
  return { start: addDays(prevClose, 1), close, due: nextDom(close, card.paymentDueDay) };
}

function cyclesFor(card, from, to) {
  const cycles = [];
  let close = domIn(from, card.cycleCloseDay);
  const prevCloseOf = (c) => {
    let p = addDays(c, -1);
    while (+p.slice(8, 10) !== Math.min(card.cycleCloseDay, daysInMonth(+p.slice(0, 4), +p.slice(5, 7)))) p = addDays(p, -1);
    return p;
  };
  while (cmp(close, from) > 0) close = prevCloseOf(close);
  close = prevCloseOf(close);
  for (let i = 0; i < 80; i++) {
    const nc = nextDom(close, card.cycleCloseDay);
    const due = nextDom(nc, card.paymentDueDay);
    if (cmp(due, to) > 0 && cmp(nc, to) > 0) break;
    if (cmp(due, from) >= 0) cycles.push({ start: addDays(close, 1), close: nc, due });
    close = nc;
  }
  return cycles;
}

function projectStatements(card, cardRules, txs, from, to, extraCharges = []) {
  const asOf = card.balanceAsOf || from;
  const sumRec = (a, b) => cmp(a, b) > 0 ? 0 :
    cardRules.reduce((s, r) => s + expandRule(r, a, b).length * Number(r.amount), 0);
  return cyclesFor(card, from, to).map((cy) => {
    let st;
    if (cmp(cy.close, asOf) < 0) st = Number(card.statementBalance) || 0;
    else if (cmp(cy.start, asOf) <= 0)
      st = Number(card.currentBalance) + daysBetween(asOf, cy.close) * Number(card.dailySpendEstimate || 0) + sumRec(addDays(asOf, 1), cy.close);
    else
      st = (daysBetween(cy.start, cy.close) + 1) * Number(card.dailySpendEstimate || 0) + sumRec(cy.start, cy.close);
    if (card.annualFeeMonth && +cy.close.slice(5, 7) === +card.annualFeeMonth) st += Number(card.annualFee) || 0;
    const lowerBound = cmp(cy.start, asOf) <= 0 ? asOf : addDays(cy.start, -1);
    st += extraCharges
      .filter((x) => cmp(x.date, lowerBound) > 0 && cmp(x.date, cy.close) <= 0)
      .reduce((sum, x) => sum + Math.abs(Number(x.amount)), 0);
    const paid = txs.filter((t) => t.type === "card_payment" && t.creditCardId === card.id &&
      cmp(t.date, cy.close) > 0 && cmp(t.date, cy.due) <= 0)
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return {
      cardId: card.id, cardName: card.name, cycleStart: cy.start, cycleClose: cy.close, paymentDue: cy.due,
      statement: round2(st), scheduledPayments: round2(paid), implied: round2(Math.max(0, st - paid)),
    };
  });
}

/* ---------------- engine: main fold ---------------- */
function project({ anchor, today, horizonEnd, rules, incomes, transactions, cards, viewStart, simCardCharges = [] }) {
  const from = viewStart && cmp(viewStart, anchor.date) < 0 ? viewStart : anchor.date;
  const to = horizonEnd;
  const byDate = new Map();
  const push = (e) => {
    if (cmp(e.date, from) < 0 || cmp(e.date, to) > 0) return;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  };
  for (const t of transactions) {
    if (t.skipped || t.type === "card_charge") continue;   // card charges hit the card, not checking
    push({ date: t.date, amount: Number(t.amount), description: t.description || t.type, source: "ledger",
      type: t.type, status: t.status, ledgerId: t.id, recurringExpenseId: t.recurringExpenseId, creditCardId: t.creditCardId });
  }
  const overridden = new Set(transactions.filter((t) => t.recurringExpenseId && t.occurrenceDate)
    .map((t) => `${t.recurringExpenseId}|${t.occurrenceDate}`));
  for (const r of rules) {
    if (r.paymentSource !== "checking") continue;
    for (const d of expandRule(r, from, to)) {
      if (overridden.has(`${r.id}|${d}`)) continue;
      push({ date: d, amount: -Number(r.amount), description: r.name, source: "virtual_recurring",
        type: "recurring_instance", status: "scheduled", recurringExpenseId: r.id });
    }
  }
  const realPaydays = new Set(transactions.filter((t) => t.type === "paycheck").map((t) => t.date));
  for (const pc of expandPaychecks(incomes, from, to)) {
    if (realPaydays.has(pc.date)) continue;
    push({ date: pc.date, amount: pc.net, description: "Paycheck", source: "virtual_paycheck", type: "paycheck", status: "scheduled" });
  }
  const statements = cards.flatMap((c) =>
    projectStatements(c, rules.filter((r) => r.paymentSource === "card" && r.creditCardId === c.id), transactions, from, to,
      simCardCharges.filter((x) => x.source === c.id)));
  for (const s of statements) {
    if (s.implied <= 0 || cmp(s.paymentDue, today) < 0) continue;
    push({ date: s.paymentDue, amount: -s.implied, description: `${s.cardName} payment (projected)`,
      source: "implied_card_payment", type: "implied_card_payment", status: "projected", creditCardId: s.cardId });
  }
  // The anchor is the source of truth: when the view starts earlier, back out
  // every event between the view start and the anchor to find the opening balance.
  let opening = Number(anchor.balance);
  if (cmp(from, anchor.date) < 0) {
    let back = 0;
    for (const [d, evs] of byDate)
      if (cmp(d, from) >= 0 && cmp(d, anchor.date) <= 0)
        back += evs.reduce((sm, e) => sm + e.amount, 0);
    opening = round2(opening - back);
  }
  const days = [];
  let bal = opening, minB = bal, minD = from, firstNeg = null;
  let cur = from;
  while (cmp(cur, to) <= 0) {
    const events = (byDate.get(cur) || []).sort((a, b) => b.amount - a.amount);
    bal = round2(bal + events.reduce((s, e) => s + e.amount, 0));
    const negative = bal < 0;
    if (negative && !firstNeg) firstNeg = cur;
    if (bal < minB) { minB = bal; minD = cur; }
    days.push({ date: cur, events, endBalance: bal, negative });
    cur = addDays(cur, 1);
  }
  const overdue = days.filter((d) => cmp(d.date, today) < 0).flatMap((d) => d.events)
    .filter((e) => (e.source === "ledger" && e.status === "scheduled") || e.source === "virtual_recurring");
  return { days, statements, overdue, firstNegativeDate: firstNeg, minBalance: minB, minBalanceDate: minD };
}

/* ---------------- card cycle reconciliation ---------------- */
function cardChargeState(transactions, key) {
  return (transactions || []).find((t) => t.type === "card_charge" && t.chargeKey === key);
}

function buildCycleView(card, rules, transactions, today) {
  const cycle = currentCycle(card, today);
  const asOf = card.balanceAsOf || cycle.start;
  const charges = expandCardCharges(card, rules, cycle.start, cycle.close).map((c) => {
    const st = cardChargeState(transactions, c.key);
    return { ...c, posted: !!st && !st.skipped, skipped: !!(st && st.skipped),
      postedOn: st && !st.skipped ? st.date : null };
  });
  const live = charges.filter((c) => !c.skipped);
  const postedSinceAsOf = live.filter((c) => c.posted && cmp(c.postedOn || c.date, asOf) > 0)
    .reduce((s, c) => s + c.amount, 0);
  const daysAccrued = Math.max(0, daysBetween(asOf, today));
  const estSpend = daysAccrued * Number(card.dailySpendEstimate || 0);
  const plannedNow = round2(Number(card.currentBalance) + postedSinceAsOf + estSpend);
  const awaiting = live.filter((c) => !c.posted && cmp(c.date, today) <= 0 && cmp(c.date, asOf) > 0);
  const remaining = live.filter((c) => !c.posted && cmp(c.date, today) > 0).reduce((s, c) => s + c.amount, 0);
  const daysToClose = Math.max(0, daysBetween(today, cycle.close));
  const projectedClose = round2(plannedNow + remaining + daysToClose * Number(card.dailySpendEstimate || 0));
  return { cycle, asOf, charges, plannedNow, estSpend, daysAccrued, awaiting, remaining, daysToClose, projectedClose };
}

/** Every fixed charge that lands on a card in [from, to] — the single source. */
function expandCardCharges(card, rules, from, to) {
  const out = [];
  for (const r of rules) {
    if (r.paymentSource !== "card" || r.creditCardId !== card.id || !r.active) continue;
    for (const d of expandRule(r, from, to))
      out.push({ key: `${r.id}|${d}`, name: r.name, date: d, amount: Number(r.amount),
        cardId: card.id, cardName: card.name, ruleId: r.id });
  }
  if (card.annualFeeMonth && Number(card.annualFee) > 0) {
    let probe = domIn(from, card.cycleCloseDay);
    while (cmp(probe, to) <= 0) {
      if (cmp(probe, from) >= 0 && +probe.slice(5, 7) === +card.annualFeeMonth)
        out.push({ key: `fee|${card.id}|${probe}`, name: "Annual fee", date: probe,
          amount: Number(card.annualFee), cardId: card.id, cardName: card.name });
      probe = nextDom(probe, card.cycleCloseDay);
    }
  }
  return out.sort((a, b) => cmp(a.date, b.date));
}

const cardChargesIn = (rules, cards, from, to) =>
  cards.flatMap((c) => expandCardCharges(c, rules, from, to));

/** Roll a projection's days up into months — used by every forward-looking view. */
function monthlyRollup(days) {
  const map = new Map();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    if (!map.has(k)) map.set(k, { key: k, flow: 0, end: d.endBalance, min: d.endBalance, minDate: d.date,
      income: 0, spend: 0, days: [] });
    const m = map.get(k);
    for (const e of d.events) {
      m.flow += e.amount;
      if (e.amount > 0) m.income += e.amount; else m.spend -= e.amount;
    }
    m.end = d.endBalance;
    m.days.push(d);
    if (d.endBalance < m.min) { m.min = d.endBalance; m.minDate = d.date; }
  }
  return [...map.values()].map((m) => ({ ...m, flow: round2(m.flow), income: round2(m.income), spend: round2(m.spend) }));
}

/* ---------------- variable (unbudgeted) spend ----------------
   Accounting identity per card:
     balance_end = balance_start + fixed + variable − payments
   so:
     variable = (balance_end − balance_start) − fixed + payments
   Fixed = recurring charges assigned to the card (+ annual fee in its
   month). Payments = card_payment transactions. Everything left over is
   real discretionary spending.
------------------------------------------------------------- */
function fixedChargesIn(card, rules, a, b) {
  if (cmp(a, b) >= 0) return 0;
  return round2(expandCardCharges(card, rules, addDays(a, 1), b).reduce((s, c) => s + c.amount, 0));
}

function paymentsIn(card, transactions, a, b) {
  return round2(transactions
    .filter((t) => t.type === "card_payment" && t.creditCardId === card.id && !t.skipped &&
      cmp(t.date, a) > 0 && cmp(t.date, b) <= 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
}

/** Logged observations plus the card's own current balance, newest last. */
function observationsFor(card, observations) {
  const list = (observations || []).filter((o) => o.cardId === card.id).map((o) => ({ date: o.date, balance: Number(o.balance) }));
  if (card.balanceAsOf) list.push({ date: card.balanceAsOf, balance: Number(card.currentBalance) });
  const byDate = new Map();
  for (const o of list.sort((x, y) => cmp(x.date, y.date))) byDate.set(o.date, o);
  return [...byDate.values()];
}

function variableSpendWindow(card, rules, transactions, observations, winStart, winEnd) {
  const obs = observationsFor(card, observations);
  if (obs.length < 2) return null;
  const start = [...obs].reverse().find((o) => cmp(o.date, winStart) <= 0) || obs.find((o) => cmp(o.date, winStart) >= 0);
  const end = [...obs].reverse().find((o) => cmp(o.date, winEnd) <= 0);
  if (!start || !end || cmp(end.date, start.date) <= 0) return null;
  const fixed = fixedChargesIn(card, rules, start.date, end.date);
  const payments = paymentsIn(card, transactions, start.date, end.date);
  const delta = round2(end.balance - start.balance);
  return {
    cardId: card.id, cardName: card.name, from: start.date, to: end.date,
    days: daysBetween(start.date, end.date), startBalance: start.balance, endBalance: end.balance,
    delta, fixed, payments, variable: round2(delta - fixed + payments),
  };
}

function totalVariableSpend(data, winStart, winEnd) {
  const per = data.cards
    .map((c) => variableSpendWindow(c, data.rules, data.transactions, data.observations, winStart, winEnd))
    .filter(Boolean);
  const variable = round2(per.reduce((s, x) => s + x.variable, 0));
  const days = per.reduce((m, x) => Math.max(m, x.days), 0);
  return { per, variable, days, perDay: days > 0 ? round2(variable / days) : 0 };
}

/* ---------------- spending assumptions ---------------- */
const PER_TO_MONTH = { day: 365 / 12, week: 52 / 12, month: 1 };
const assumptionMonthly = (a) => round2((Number(a.amount) || 0) * (Number(a.count) || 0) * PER_TO_MONTH[a.per || "month"]);
const monthlyToDaily = (m) => round2((Number(m) || 0) * 12 / 365);

/* ---------------- assets & wealth ----------------
   Assets are held separately from cash flow: they never touch the
   checking forecast. Each grows monthly by its return rate and any
   contribution, which for retirement and HSA accounts is derived
   from the current paycheck rather than typed twice.
------------------------------------------------- */
const ASSET_KINDS = [
  ["retirement", "Retirement (401k)"], ["hsa", "HSA"],
  ["brokerage", "Brokerage"], ["savings", "Savings"], ["other", "Other"],
];

function contributionFor(asset, incomes) {
  if (asset.contributionOverride !== "" && asset.contributionOverride != null) return Number(asset.contributionOverride) || 0;
  const latest = [...(incomes || [])].sort((a, b) => cmp(b.effectiveDate, a.effectiveDate))[0];
  const b = latest && latest.breakdown;
  if (!b) return 0;
  if (asset.kind === "retirement") return round2((Number(b.k401 || 0) + Number(b.roth || 0) + Number(b.match || 0)) * PERIODS / 12);
  if (asset.kind === "hsa") return round2(Number(b.hsa || 0) * PERIODS / 12);
  return 0;
}

/** Month-by-month balance for `months` months, contributions at month end. */
function projectAsset(asset, monthlyContribution, months, useReturns = false) {
  const r = useReturns ? (Number(asset.annualReturnPct) || 0) / 100 / 12 : 0;
  let bal = Number(asset.balance) || 0;
  const out = [bal];
  for (let i = 0; i < months; i++) {
    bal = bal * (1 + r) + monthlyContribution;
    out.push(round2(bal));
  }
  return out;
}

/* ---------------- demo seed ---------------- */
function seedData() {
  const today = todayISO();
  const payroll = { ...DEFAULT_PAYROLL };
  const currentSalary = 125672;
  const pc = computePaycheck(currentSalary, payroll);
  return {
    anchor: { date: addDays(today, -4), balance: 6240 },
    payroll,
    observations: [
      { id: "o1", cardId: "amex", date: addDays(today, -34), balance: 380 },
      { id: "o2", cardId: "amex", date: addDays(today, -20), balance: 1240 },
      { id: "o3", cardId: "amex", date: addDays(today, -6), balance: 1100 },
      { id: "o4", cardId: "bilt", date: addDays(today, -34), balance: 120 },
      { id: "o5", cardId: "bilt", date: addDays(today, -6), balance: 2350 },
    ],
    simulations: [],
    assets: [
      { id: "as1", name: "Vanguard 401(k)", kind: "retirement", balance: 84200, asOf: today, annualReturnPct: 7, contributionOverride: "" },
      { id: "as2", name: "Cigna HSA", kind: "hsa", balance: 6840, asOf: today, annualReturnPct: 4, contributionOverride: "" },
      { id: "as3", name: "Emergency savings", kind: "savings", balance: 12000, asOf: today, annualReturnPct: 3.8, contributionOverride: 0 },
    ],
    assumptions: [
      { id: "a1", name: "Groceries", amount: 100, count: 1, per: "week" },
      { id: "a2", name: "Coffee", amount: 3, count: 3, per: "week" },
      { id: "a3", name: "Dining out", amount: 55, count: 1, per: "week" },
      { id: "a4", name: "Gas", amount: 45, count: 1, per: "week" },
      { id: "a5", name: "Everything else", amount: 220, count: 1, per: "month" },
    ],
    cards: [
      { id: "amex", name: "Amex Gold", cycleCloseDay: 20, paymentDueDay: 15, annualFee: 325, annualFeeMonth: 3, currentBalance: 1100, balanceAsOf: addDays(today, -6), dailySpendEstimate: 60 },
      { id: "bilt", name: "Bilt Mastercard", cycleCloseDay: 26, paymentDueDay: 22, annualFee: 0, annualFeeMonth: "", currentBalance: 2350, balanceAsOf: addDays(today, -6), dailySpendEstimate: 0 },
      { id: "venture", name: "Capital One VentureOne", cycleCloseDay: 8, paymentDueDay: 5, annualFee: 0, annualFeeMonth: "", currentBalance: 86, balanceAsOf: today, dailySpendEstimate: 0 },
      { id: "apple", name: "Apple Card", cycleCloseDay: 31, paymentDueDay: 31, annualFee: 0, annualFeeMonth: "", currentBalance: 42, balanceAsOf: today, dailySpendEstimate: 0 },
    ],
    rules: [
      { id: "rent", name: "Rent", amount: 2350, category: "Housing", paymentSource: "card", creditCardId: "bilt", frequency: "monthly", dueDay: 1, startDate: "2025-01-01", endDate: "", active: true },
      { id: "internet", name: "Internet", amount: 80, category: "Utilities", paymentSource: "checking", creditCardId: "", frequency: "monthly", dueDay: 5, startDate: "2025-01-05", endDate: "", active: true },
      { id: "insurance", name: "Car insurance", amount: 145, category: "Auto", paymentSource: "checking", creditCardId: "", frequency: "monthly", dueDay: 12, startDate: "2025-01-12", endDate: "", active: true },
      { id: "utilities", name: "Electric + water", amount: 130, category: "Utilities", paymentSource: "checking", creditCardId: "", frequency: "monthly", dueDay: 18, startDate: "2025-01-18", endDate: "", active: true },
      { id: "netflix", name: "Netflix", amount: 24.99, category: "Subscriptions", paymentSource: "card", creditCardId: "amex", frequency: "monthly", dueDay: 9, startDate: "2025-01-09", endDate: "", active: true },
      { id: "gym", name: "Gym", amount: 45, category: "Health", paymentSource: "card", creditCardId: "amex", frequency: "monthly", dueDay: 3, startDate: "2025-01-03", endDate: "", active: true },
      { id: "spotify", name: "Spotify", amount: 11.99, category: "Subscriptions", paymentSource: "card", creditCardId: "amex", frequency: "monthly", dueDay: 22, startDate: "2025-01-22", endDate: "", active: true },
      { id: "icloud", name: "iCloud+", amount: 9.99, category: "Subscriptions", paymentSource: "card", creditCardId: "apple", frequency: "monthly", dueDay: 14, startDate: "2025-01-14", endDate: "", active: true },
    ],
    incomes: [
      { id: "p1", effectiveDate: "2025-01-01", anchorPayDate: addDays(today, -5), annualSalary: currentSalary,
        gross: pc.gross, k401: pc.k401, hsa: pc.hsa, taxes: pc.taxes, carDeduction: pc.car, carBenefit: 0,
        netPaycheck: pc.net, breakdown: pc },
    ],
    transactions: [
      { id: "t-hoa", date: addDays(today, -2), amount: -180, type: "one_time_expense", status: "scheduled", description: "HOA fee" },
      { id: "t-transfer", date: addDays(today, -3), amount: -500, type: "transfer", status: "paid", description: "Transfer to savings" },
    ],
  };
}

function Field({ lab, children }) {
  return <label><div className="lab">{lab}</div>{children}</label>;
}

/* ---------------- shared operations ----------------
   One function per fact, called from wherever the user happens to be.
------------------------------------------------- */
function setCardBalance(d, cardId, balance, date) {
  return {
    ...d,
    cards: d.cards.map((c) => c.id === cardId
      ? (cmp(date, c.balanceAsOf || "0000-01-01") >= 0 ? { ...c, currentBalance: balance, balanceAsOf: date } : c)
      : c),
    observations: [...(d.observations || []).filter((o) => !(o.cardId === cardId && o.date === date)),
      { id: uid(), cardId, date, balance }],
  };
}

function toggleCardCharge(d, charge) {
  const existing = (d.transactions || []).find((t) => t.type === "card_charge" && t.chargeKey === charge.key);
  if (existing) return { ...d, transactions: d.transactions.filter((t) => t.id !== existing.id) };
  return { ...d, transactions: [...d.transactions, {
    id: uid(), type: "card_charge", chargeKey: charge.key, creditCardId: charge.cardId,
    recurringExpenseId: charge.ruleId, date: charge.date, amount: -Math.abs(charge.amount),
    description: charge.name, status: "paid",
  }] };
}

/** Confirm / skip a checking event that should already have happened. */
function confirmCashEvent(d, e, skipped) {
  if (e.ledgerId) return { ...d, transactions: d.transactions.map((t) =>
    t.id === e.ledgerId ? { ...t, ...(skipped ? { skipped: true } : { status: "paid" }) } : t) };
  return { ...d, transactions: [...d.transactions, {
    id: uid(), date: e.date, amount: e.amount, type: "recurring_instance",
    status: skipped ? "scheduled" : "paid", skipped, description: e.description,
    recurringExpenseId: e.recurringExpenseId, occurrenceDate: e.date,
  }] };
}

/* ---------------- card cycle panel ---------------- */
function CardCycle({ card, data, setData, today }) {
  const v = buildCycleView(card, data.rules, data.transactions, today);
  const [actual, setActual] = useState("");
  const gap = actual === "" || isNaN(+actual) ? null : round2(+actual - v.plannedNow);
  const dailyEst = Number(card.dailySpendEstimate || 0);
  const actualRate = gap !== null && v.daysAccrued > 0 && dailyEst > 0 ? round2((v.estSpend + gap) / v.daysAccrued) : null;

  const toggle = (c) => setData((d) => toggleCardCharge(d, c));
  const applyActual = () => { setData((d) => setCardBalance(d, card.id, +actual, today)); setActual(""); };
  const schedulePayment = () => setData((d) => ({ ...d, transactions: [...d.transactions, {
    id: uid(), date: v.cycle.due, amount: -Math.abs(v.projectedClose), type: "card_payment",
    status: "scheduled", description: `${card.name} payment`, creditCardId: card.id }] }));
  const alreadyScheduled = data.transactions.some((t) => t.type === "card_payment" && t.creditCardId === card.id &&
    cmp(t.date, v.cycle.close) > 0 && cmp(t.date, v.cycle.due) <= 0);

  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="cyclehead">
        <h2>{card.name}</h2>
        <div className="when">cycle {shortDate(v.cycle.start)} – {shortDate(v.cycle.close)} · payment due {shortDate(v.cycle.due)}</div>
      </div>
      <div className="trio">
        <div>
          <div className="lab">Planned balance now</div>
          <div className="val">{money(v.plannedNow)}</div>
          <div className="when" style={{ marginTop: 2 }}>from {money(card.currentBalance)} on {shortDate(v.asOf)}</div>
        </div>
        <div>
          <div className="lab">Actual balance</div>
          <div style={{ display: "flex", gap: 7, marginTop: 2 }}>
            <input type="number" inputMode="decimal" placeholder={v.plannedNow.toFixed(2)} value={actual} onChange={(e) => setActual(e.target.value)} />
            <button className="primary" disabled={gap === null} onClick={applyActual}>Set</button>
          </div>
          <div className="when" style={{ marginTop: 4 }}>enter what the card app shows</div>
        </div>
        <div>
          <div className="lab">Unaccounted</div>
          <div className={`val ${gap === null ? "" : Math.abs(gap) < 0.005 ? "pos" : gap > 0 ? "amber" : "pos"}`}>
            {gap === null ? "—" : signed(gap)}
          </div>
          <div className="when" style={{ marginTop: 2 }}>
            {gap === null ? "extra charges vs plan"
              : Math.abs(gap) < 0.005 ? "exactly on plan"
              : actualRate !== null ? `running ${money(actualRate)}/day vs ${money(dailyEst)} est.`
              : gap > 0 ? "extra charges not modelled" : "less than planned"}
          </div>
        </div>
      </div>
      {v.awaiting.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 8 }}>
          {v.awaiting.length} charge{v.awaiting.length > 1 ? "s" : ""} should have posted by now — tick them if they have.
        </div>
      )}
      <div className="eyebrow" style={{ marginBottom: 4 }}>Fixed charges this cycle</div>
      {v.charges.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13 }}>No recurring charges on this card.</div>}
      {v.charges.map((c) => {
        const awaiting = !c.posted && !c.skipped && cmp(c.date, today) <= 0;
        return (
          <div className="chargerow" key={c.key} style={{ opacity: c.skipped ? 0.45 : 1 }}>
            <button className={`tick ${c.posted ? "on" : awaiting ? "await" : ""}`} onClick={() => toggle(c)}
              title={c.posted ? "Posted — click to undo" : "Mark as posted"}>{c.posted ? "✓" : ""}</button>
            <div style={{ flex: 1 }}>
              <span style={{ opacity: c.posted ? 1 : 0.75 }}>{c.name}</span>
              {c.posted && <span className="tag good">posted</span>}
              {c.skipped && <span className="tag">skipped</span>}
              {awaiting && <span className="tag overdue">expected</span>}
              {!c.posted && !c.skipped && !awaiting && <span className="tag">upcoming</span>}
            </div>
            <span className="when" style={{ minWidth: 52, textAlign: "right" }}>{shortDate(c.date)}</span>
            <span className="amt" style={{ minWidth: 82, textAlign: "right" }}>{money(c.amount)}</span>
          </div>
        );
      })}
      {dailyEst > 0 && (
        <div className="chargerow" style={{ color: "var(--mut)" }}>
          <span className="tick" style={{ border: "1px dashed var(--line)" }} />
          <div style={{ flex: 1 }}>Daily spending estimate<span className="tag projected">modelled</span></div>
          <span className="when" style={{ minWidth: 52, textAlign: "right" }}>{v.daysAccrued}d</span>
          <span className="amt" style={{ minWidth: 82, textAlign: "right" }}>{money(v.estSpend)}</span>
        </div>
      )}
      <div className="cyclefoot">
        <div>
          <span className="eyebrow">Projected at close {shortDate(v.cycle.close)}</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="amt" style={{ fontSize: 19 }}>{money(v.projectedClose)}</span>
            <span className="when">
              {v.remaining > 0 ? `+${money(v.remaining)} fixed still to post` : "all fixed charges accounted"}
              {dailyEst > 0 ? ` · +${money(v.daysToClose * dailyEst)} est. spend (${v.daysToClose}d)` : ""}
            </span>
          </div>
        </div>
        {alreadyScheduled
          ? <span className="tag good">payment scheduled</span>
          : <button onClick={schedulePayment}>Schedule {money(v.projectedClose)} on {shortDate(v.cycle.due)}</button>}
      </div>
    </section>
  );
}

/* ---------------- dashboard: the month timeline ---------------- */
const EVENT_LABEL = {
  paycheck: "income", recurring_instance: "fixed", implied_card_payment: "card payment",
  card_payment: "card payment", one_time_expense: "one-off", deposit: "deposit",
  transfer: "transfer", adjustment: "adjustment",
};

function Dashboard({ data, setData, projection, today }) {
  const [offset, setOffset] = useState(0);
  const [showQuiet, setShowQuiet] = useState(true);
  const [actual, setActual] = useState("");
  const [showEntry, setShowEntry] = useState(false);
  const [openDays, setOpenDays] = useState(() => new Set([today]));
  const [entry, setEntry] = useState({ date: today, amount: "", kind: "one_time_expense", description: "", creditCardId: "", status: "scheduled" });

  const thisMonthStart = `${today.slice(0, 7)}-01`;
  const monthStart = `${addMonths(thisMonthStart, offset).slice(0, 7)}-01`;
  const monthEnd = endOfMonth(monthStart);

  const expected = projection.days.find((d) => d.date === today)?.endBalance ?? data.anchor.balance;
  const delta = actual === "" || isNaN(+actual) ? null : +actual - expected;

  const odKeys = new Set(projection.overdue.map((e) => e.ledgerId || `${e.recurringExpenseId}|${e.date}`));
  const unconfirmed = projection.days.filter((d) => cmp(d.date, today) <= 0).flatMap((d) => d.events)
    .filter((e) => odKeys.has(e.ledgerId || `${e.recurringExpenseId}|${e.date}`));

  const monthDays = projection.days.filter((d) => cmp(d.date, monthStart) >= 0 && cmp(d.date, monthEnd) <= 0);
  const openingBalance = monthDays.length
    ? round2(monthDays[0].endBalance - monthDays[0].events.reduce((s, e) => s + e.amount, 0)) : 0;
  const closingBalance = monthDays.length ? monthDays[monthDays.length - 1].endBalance : 0;
  const inflow = round2(monthDays.flatMap((d) => d.events).filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0));
  const outflow = round2(monthDays.flatMap((d) => d.events).filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0));
  const lowDay = monthDays.reduce((a, b) => (b.endBalance < a.endBalance ? b : a), monthDays[0] || { endBalance: 0, date: monthStart });

  // sparkline
  const W = 1000, H = 46;
  const bals = monthDays.map((d) => d.endBalance);
  const hi = Math.max(...bals, 0), lo = Math.min(...bals, 0);
  const padY = (hi - lo) * 0.15 || 100;
  const sx = (i) => (i / Math.max(monthDays.length - 1, 1)) * W;
  const sy = (b) => ((hi + padY - b) / (hi + padY - (lo - padY))) * H;
  const spark = monthDays.map((d, i) => `${sx(i).toFixed(1)},${sy(d.endBalance).toFixed(1)}`).join(" L ");
  const todayIdx = monthDays.findIndex((d) => d.date === today);

  const cardAwaiting = useMemo(() => data.cards.flatMap((c) =>
    buildCycleView(c, data.rules, data.transactions, today).awaiting.map((x) => ({ ...x, kind: "card" }))
  ), [data.cards, data.rules, data.transactions, today]);

  const queue = [
    ...unconfirmed.map((e) => ({ ...e, kind: "cash" })),
    ...cardAwaiting,
  ].sort((x, y) => cmp(x.date, y.date));

  const confirm_ = (item) => setData((d) => item.kind === "card"
    ? toggleCardCharge(d, item) : confirmCashEvent(d, item, false));
  const dismiss = (item) => setData((d) => item.kind === "card"
    ? { ...d, transactions: [...d.transactions, { id: uid(), type: "card_charge", chargeKey: item.key,
        creditCardId: item.cardId, date: item.date, amount: 0, description: item.name,
        status: "scheduled", skipped: true }] }
    : confirmCashEvent(d, item, true));

  const oneOffs = [...data.transactions]
    .filter((t) => !t.recurringExpenseId && t.type !== "card_charge" && cmp(t.date, monthStart) >= 0 && cmp(t.date, monthEnd) <= 0)
    .sort((x, y) => cmp(y.date, x.date));

  const addEntry = () => {
    if (!entry.amount) return;
    setData((d) => ({ ...d, transactions: [...d.transactions, {
      id: uid(), date: entry.date, amount: entry.kind === "deposit" ? Math.abs(+entry.amount) : -Math.abs(+entry.amount),
      type: entry.kind, status: entry.status, description: entry.description || entry.kind.replace(/_/g, " "),
      creditCardId: entry.kind === "card_payment" ? entry.creditCardId : undefined }] }));
    setEntry({ ...entry, amount: "", description: "" });
    setShowEntry(false);
  };

  return (
    <>
      <div className="screenhead">
        <h1>Today</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="ghost" disabled={offset <= 0} onClick={() => setOffset(offset - 1)}>‹</button>
            <span className="num" style={{ fontSize: 15, minWidth: 104, textAlign: "center" }}>{monthName(monthStart)}</span>
            <button className="ghost" onClick={() => setOffset(offset + 1)}>›</button>
          </div>
          <button onClick={() => setShowEntry(!showEntry)}>{showEntry ? "Cancel" : "+ Add entry"}</button>
        </div>
      </div>

      <div className="statgrid">
        <section className="panel">
          <div className="eyebrow">Expected today</div>
          <div className="bignum">{money(expected)}</div>
          <div className="when">what the forecast says</div>
        </section>
        <section className="panel">
          <div className="eyebrow">Actual from your bank</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input type="number" inputMode="decimal" placeholder={expected.toFixed(2)} value={actual} onChange={(e) => setActual(e.target.value)} />
            <button className="primary" disabled={delta === null} onClick={() => { setData((d) => ({ ...d, anchor: { date: today, balance: +actual } })); setActual(""); }}>Anchor</button>
          </div>
          <div className="when" style={{ marginTop: 5 }}>last anchored {shortDate(data.anchor.date)}</div>
        </section>
        <section className="panel">
          <div className="eyebrow">Difference</div>
          <div className="bignum" style={{ color: delta !== null && Math.abs(delta) >= 0.005 ? "var(--red)" : "var(--green)" }}>
            {delta === null ? "—" : Math.abs(delta) < 0.005 ? "$0.00" : signed(delta)}
          </div>
          <div className="when">{delta === null ? "enter a balance to compare" : Math.abs(delta) < 0.005 ? "matches — all good" : "check the list below"}</div>
        </section>
      </div>

      {queue.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div>
              <span className="gname">To confirm</span>
              <div className="when" style={{ marginTop: 1 }}>due on or before today, not yet ticked off</div>
            </div>
            <span className="tag overdue">{queue.length}</span>
          </div>
          {queue.map((item, i) => (
            <div className="row" key={i}>
              <div style={{ flex: 1 }}>
                <span>{item.kind === "card" ? item.name : item.description}</span>
                <span className="tag">{item.kind === "card" ? item.cardName : "checking"}</span>
                <div className="when">{shortDate(item.date)}</div>
              </div>
              <span className="amt">{item.kind === "card" ? money(item.amount) : signed(item.amount)}</span>
              <button onClick={() => confirm_(item)}>{item.kind === "card" ? "Posted" : "Paid"}</button>
              <button className="ghost" onClick={() => dismiss(item)}>Didn’t happen</button>
            </div>
          ))}
        </section>
      )}

      {showEntry && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div><span className="gname">Add an entry</span><div className="when" style={{ marginTop: 1 }}>one-off expenses, deposits, transfers and card payments</div></div>
          </div>
          <div className="formgrid" style={{ marginTop: 8 }}>
            <Field lab="Type"><select value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}>
              <option value="one_time_expense">One-time expense</option>
              <option value="deposit">Deposit</option>
              <option value="transfer">Transfer out</option>
              <option value="adjustment">Adjustment (−)</option>
              <option value="card_payment">Card payment</option>
            </select></Field>
            <Field lab="Date"><input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field>
            <Field lab="Amount $"><input type="number" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></Field>
            <Field lab="Description"><input value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /></Field>
            {entry.kind === "card_payment" && <Field lab="Card"><select value={entry.creditCardId} onChange={(e) => setEntry({ ...entry, creditCardId: e.target.value })}>
              <option value="">Select…</option>
              {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></Field>}
            <Field lab="Status"><select value={entry.status} onChange={(e) => setEntry({ ...entry, status: e.target.value })}>
              <option value="scheduled">Scheduled</option><option value="paid">Paid</option>
            </select></Field>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button className="primary" disabled={!entry.amount || (entry.kind === "card_payment" && !entry.creditCardId)} onClick={addEntry}>Add</button>
            </div>
          </div>
          {oneOffs.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 14, marginBottom: 2 }}>One-off entries this month</div>
              {oneOffs.map((t) => (
                <div className="detrow" key={t.id} style={{ opacity: t.skipped ? 0.45 : 1 }}>
                  <span className="dt">{shortDate(t.date)}</span>
                  <span className="dn">{t.description}</span>
                  <span className="tag">{t.status}</span>
                  <span className="amt da">{signed(Number(t.amount))}</span>
                  <button className="danger-btn" onClick={() => setData((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== t.id) }))}>✕</button>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="grouphead">
          <div>
            <span className="gname">{monthName(monthStart)} · checking</span>
            <div className="when" style={{ marginTop: 1 }}>
              opens {money(openingBalance)} · lowest {money(lowDay.endBalance)} on {shortDate(lowDay.date)}
            </div>
          </div>
          <label style={{ fontSize: 12.5, color: "var(--mut)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} style={{ width: "auto" }} />
            empty days
          </label>
        </div>

        <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1="0" y1={sy(0)} x2={W} y2={sy(0)} stroke="#e7e3d9" />
          <path d={`M ${spark}`} fill="none" stroke={closingBalance < 0 || lowDay.endBalance < 0 ? "#b5462f" : "#2d6a4f"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {todayIdx >= 0 && <line x1={sx(todayIdx)} y1="0" x2={sx(todayIdx)} y2={H} stroke="#52b788" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>

        <div className="yearhead dgrid">
          <span>Day</span><span>Activity</span><span>In</span><span>Out</span><span>Balance</span>
        </div>
        {monthDays.map((d) => {
          const quiet = d.events.length === 0;
          if (quiet && !showQuiet) return null;
          const isToday = d.date === today;
          const past = cmp(d.date, today) < 0;
          const isOpen = openDays.has(d.date);
          const dIn = round2(d.events.filter((e) => e.amount > 0).reduce((s2, e) => s2 + e.amount, 0));
          const dOut = round2(d.events.filter((e) => e.amount < 0).reduce((s2, e) => s2 - e.amount, 0));
          const toggleDay = () => { if (quiet) return; setOpenDays((prev) => {
            const n = new Set(prev); n.has(d.date) ? n.delete(d.date) : n.add(d.date); return n; }); };
          return (
            <div key={d.date}>
              <div className={`yearrow dgrid${isOpen ? " open" : ""}${isToday ? " todayrow" : ""}${quiet ? " empty" : ""}${past && !isToday ? " pastrow" : ""}`}
                onClick={toggleDay} role={quiet ? undefined : "button"} tabIndex={quiet ? undefined : 0}
                onKeyDown={(e) => { if (!quiet && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleDay(); } }}>
                <span className="mname">
                  {!quiet && (isOpen ? "▾ " : "▸ ")}{+d.date.slice(8, 10)}
                  <span className="wd"> {weekday(d.date)}</span>
                </span>
                <span className="dact">
                  {quiet ? <span style={{ color: "var(--faint)" }}>—</span> : d.events.map((e) => e.description).join(" · ")}
                  {isToday && <span className="tag good">today</span>}
                </span>
                <span className="num pos">{dIn > 0 ? money(dIn) : ""}</span>
                <span className="num">{dOut > 0 ? money(dOut) : ""}</span>
                <span className="num" style={{ color: d.endBalance < 0 ? "var(--red)" : quiet ? "var(--faint)" : "var(--ink)" }}>
                  {money(d.endBalance)}
                </span>
              </div>
              {isOpen && !quiet && (
                <div className="monthdetail">
                  <div className="acctblock">
                    <div className="acctname">Checking · {shortDate(d.date)}</div>
                    {d.events.map((e, i) => (
                      <div className="detrow" key={i}>
                        <span className="dt">{shortDate(e.date)}</span>
                        <span className="dn">{e.description}</span>
                        <span className="tag">{EVENT_LABEL[e.type] || e.type}</span>
                        <span className={`amt da ${e.amount >= 0 ? "pos" : ""}`}>{signed(e.amount)}</span>
                      </div>
                    ))}
                    <div className="detrow" style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 6 }}>
                      <span className="dt" />
                      <span className="dn" style={{ fontWeight: 500 }}>Balance after</span>
                      <span />
                      <span className="amt da" style={{ fontWeight: 500 }}>{money(d.endBalance)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="yearrow dgrid total">
          <span className="mname">{monthName(monthStart).split(" ")[0]} total</span>
          <span />
          <span className="num pos">{money(inflow)}</span>
          <span className="num">{money(outflow)}</span>
          <span className="num" style={{ color: closingBalance < 0 ? "var(--red)" : undefined }}>{money(closingBalance)}</span>
        </div>
      </section>

      <div className="legend" style={{ marginTop: 10 }}>
        Checking only — every row moves the balance on the right. Charges sitting on a credit card appear here as the card payment that settles them; the card’s own detail lives on the Cards tab.
      </div>

      <div className={`notice ${projection.firstNegativeDate ? "bad" : ""}`} style={{ marginTop: 14 }}>
        {projection.firstNegativeDate ? (
          <><span className="danger" style={{ fontWeight: 600 }}>Checking goes negative on {shortDate(projection.firstNegativeDate)} {projection.firstNegativeDate.slice(0, 4)}</span>
            <span style={{ color: "var(--mut)" }}>Five-year low <span className="num danger">{money(projection.minBalance)}</span> — see Horizon</span></>
        ) : (
          <><span style={{ color: "var(--green)", fontWeight: 600 }}>Checking stays above zero for five years</span>
            <span style={{ color: "var(--mut)" }}>Tightest moment <span className="num">{money(projection.minBalance)}</span> on {shortDate(projection.minBalanceDate)} {projection.minBalanceDate.slice(0, 4)} — see Horizon</span></>
        )}
      </div>
    </>
  );
}

/* ---------------- year overview ---------------- */
function Year({ data, setData, projection, baseline, today }) {
  const thisYear = +today.slice(0, 4);
  const [range, setRange] = useState("year");
  const [year, setYear] = useState(thisYear);
  const [open, setOpen] = useState(() => new Set([today.slice(0, 7)]));
  const [simForm, setSimForm] = useState({ name: "", amount: "", date: today, source: "checking" });

  const toggleMonth = (k) => setOpen((prev) => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  const sims = data.simulations || [];
  const addSim = () => {
    if (!simForm.name || !simForm.amount) return;
    setData((d) => ({ ...d, simulations: [...(d.simulations || []),
      { ...simForm, id: uid(), amount: +simForm.amount, active: true }] }));
    setSimForm({ name: "", amount: "", date: today, source: "checking" });
  };
  const toggleSim = (id) => setData((d) => ({ ...d,
    simulations: d.simulations.map((x) => x.id === id ? { ...x, active: !x.active } : x) }));
  const removeSim = (id) => setData((d) => ({ ...d, simulations: d.simulations.filter((x) => x.id !== id) }));

  const months = useMemo(() => {
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${pad(m)}`;
      const ms = `${key}-01`, me = endOfMonth(ms);
      const days = projection.days.filter((d) => cmp(d.date, ms) >= 0 && cmp(d.date, me) <= 0);
      if (!days.length) { out.push({ key, empty: true }); continue; }
      const events = days.flatMap((d) => d.events);
      const income = round2(events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0));
      const spend = round2(events.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0));
      const low = days.reduce((a, b) => (b.endBalance < a.endBalance ? b : a), days[0]);
      const cardCharges = cardChargesIn(data.rules, data.cards, ms, me);
      const simCard = sims.filter((x) => x.active && x.source !== "checking" && cmp(x.date, ms) >= 0 && cmp(x.date, me) <= 0);
      out.push({
        key, empty: false, income, spend, net: round2(income - spend),
        end: days[days.length - 1].endBalance, low: low.endBalance, lowDate: low.date,
        events, cardCharges, simCard,
      });
    }
    return out;
  }, [projection, year, data.rules, data.cards, sims]);

  const allMonths = useMemo(() => monthlyRollup(projection.days), [projection]);
  const lowest = allMonths.reduce((a, b) => (b.min < a.min ? b : a), allMonths[0] || { min: 0, key: "" });
  const lowYears = [...new Set(allMonths.map((m) => m.key.slice(0, 4)))];
  const negMonths = allMonths.filter((m) => m.flow < 0);
  const dipMonths = allMonths.filter((m) => m.min < 0);
  const balAt = (y) => projection.days[Math.min(365 * y, projection.days.length - 1)]?.endBalance ?? 0;

  const yearEnd = months.filter((m) => !m.empty).slice(-1)[0];
  const baseMin = baseline.minBalance, simMin = projection.minBalance;
  const simDelta = round2(simMin - baseMin);
  const anyActive = sims.some((x) => x.active);

  const accountName = (id) => data.cards.find((c) => c.id === id)?.name || "Checking";

  return (
    <>
      <div className="screenhead">
        <h1>{range === "year" ? "Year" : "Five years"}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="rbtns">
            <button className={range === "year" ? "active" : "ghost"} onClick={() => setRange("year")}>12 months</button>
            <button className={range === "long" ? "active" : "ghost"} onClick={() => setRange("long")}>5 years</button>
          </div>
          {range === "year" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="ghost" disabled={year <= thisYear} onClick={() => setYear(year - 1)}>‹</button>
              <span className="num" style={{ fontSize: 16, minWidth: 52, textAlign: "center" }}>{year}</span>
              <button className="ghost" disabled={year >= thisYear + 5} onClick={() => setYear(year + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="grouphead">
          <div>
            <span className="gname">Simulations</span>
            <div className="when" style={{ marginTop: 1 }}>what-if purchases — toggle to see the impact everywhere</div>
          </div>
          {anyActive && (
            <span className="amt" style={{ fontWeight: 600, color: simMin < 0 ? "var(--red)" : simDelta < 0 ? "var(--amber)" : undefined }}>
              low {money(simMin)} <span style={{ color: "var(--faint)", fontWeight: 400 }}>was {money(baseMin)}</span>
            </span>
          )}
        </div>
        {sims.map((x) => (
          <div className="row" key={x.id}>
            <div style={{ flex: 1, opacity: x.active ? 1 : 0.5 }}>
              <span>{x.name}</span>
              <span className="tag">{accountName(x.source)}</span>
              {!x.active && <span className="tag">off</span>}
              <div className="when">{shortDate(x.date)} {x.date.slice(0, 4)}</div>
            </div>
            <span className="amt" style={{ opacity: x.active ? 1 : 0.5 }}>{money(x.amount)}</span>
            <button className={x.active ? "active" : "ghost"} onClick={() => toggleSim(x.id)}>{x.active ? "On" : "Off"}</button>
            <button className="danger-btn" onClick={() => removeSim(x.id)}>✕</button>
          </div>
        ))}
        <div className="formgrid">
          <Field lab="What"><input value={simForm.name} onChange={(e) => setSimForm({ ...simForm, name: e.target.value })} placeholder="New sofa" /></Field>
          <Field lab="Amount $"><input type="number" value={simForm.amount} onChange={(e) => setSimForm({ ...simForm, amount: e.target.value })} /></Field>
          <Field lab="When"><input type="date" value={simForm.date} onChange={(e) => setSimForm({ ...simForm, date: e.target.value })} /></Field>
          <Field lab="Paid from"><select value={simForm.source} onChange={(e) => setSimForm({ ...simForm, source: e.target.value })}>
            <option value="checking">Checking</option>
            {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></Field>
          <div style={{ display: "flex", alignItems: "end" }}><button className="primary" onClick={addSim}>Add</button></div>
        </div>
        {anyActive && (
          <div className={`notice ${simMin < 0 ? "bad" : ""}`} style={{ marginTop: 12 }}>
            {simMin < 0
              ? <span className="danger" style={{ fontWeight: 600 }}>Not affordable as planned — checking dips to {money(simMin)} on {shortDate(projection.minBalanceDate)}</span>
              : <span style={{ color: "var(--green)", fontWeight: 600 }}>Affordable — checking never drops below {money(simMin)}</span>}
            <span style={{ color: "var(--mut)" }}>
              {simDelta < 0 ? `${money(Math.abs(simDelta))} tighter than without` : "no change to the low point"}
              {projection.firstNegativeDate && !baseline.firstNegativeDate ? ` · first negative day appears ${shortDate(projection.firstNegativeDate)}` : ""}
            </span>
          </div>
        )}
      </section>

      {range === "long" && (
        <>
          <div className="statgrid">
            {[1, 3, 5].map((n) => (
              <section className="panel" key={n}>
                <div className="eyebrow">Checking in {n} year{n > 1 ? "s" : ""}</div>
                <div className="bignum">{money(balAt(n))}</div>
              </section>
            ))}
          </div>
          <section className="panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
              <div className="eyebrow">Lowest balance in each month</div>
              <div style={{ fontSize: 12.5, color: "var(--mut)" }}>
                Overall low <span className={`num ${lowest.min < 0 ? "danger" : ""}`}>{money(lowest.min || 0)}</span> in {lowest.key ? monthLabel(lowest.key + "-01") : "—"}
              </div>
            </div>
            {lowYears.map((yr) => (
              <div className="lowgrid" key={yr} style={{ marginBottom: 4 }}>
                <div className="lowyr">{yr}</div>
                {Array.from({ length: 12 }, (_, mi) => {
                  const k = `${yr}-${pad(mi + 1)}`;
                  const cell = allMonths.find((x) => x.key === k);
                  if (!cell) return <div key={k} />;
                  const cls = cell.min < 0 ? "neg" : cell.min < 500 ? "low" : "";
                  return (
                    <div key={k} className={`lowcell ${cls} ${cell.key === lowest.key ? "min" : ""}`}
                      title={`${monthName(k + "-01")} · lowest ${money(cell.min)} on ${shortDate(cell.minDate)}`}>
                      {compact(cell.min)}
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--faint)" }}>
              Jan → Dec per row · red dips below $0 · amber below $500 · outlined is the five-year low
            </div>
          </section>
          <div className="grid2">
            <section className="panel">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Months that spend more than they earn ({negMonths.length})</div>
              {negMonths.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13 }}>Every month is net positive.</div>}
              {negMonths.slice(0, 18).map((m) => (
                <div className="row" key={m.key}>
                  <span>{monthLabel(m.key + "-01")}</span>
                  <span className="amt danger">{signed(m.flow)}</span>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Months that dip below $0 ({dipMonths.length})</div>
              {dipMonths.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13 }}>Checking never crosses zero.</div>}
              {dipMonths.slice(0, 18).map((m) => (
                <div className="row" key={m.key}>
                  <div><span>{monthLabel(m.key + "-01")}</span><div className="when">lowest on {shortDate(m.minDate)}</div></div>
                  <span className="amt danger">{money(m.min)}</span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}

      {range === "year" && (
      <section className="panel">
        <div className="yearhead">
          <span>Month</span><span>Income</span><span>Expenses</span><span>Net</span><span>End</span><span>Low</span><span />
        </div>
        {months.map((m) => {
          if (m.empty) return (
            <div className="yearrow empty" key={m.key}>
              <span className="mname">{monthLabel(m.key + "-01")}</span>
              <span className="when" style={{ gridColumn: "2 / -1" }}>outside the forecast window</span>
            </div>
          );
          const isOpen = open.has(m.key);
          const byCard = new Map();
          for (const c of m.cardCharges) {
            if (!byCard.has(c.cardId)) byCard.set(c.cardId, { name: c.cardName, items: [], sim: [] });
            byCard.get(c.cardId).items.push(c);
          }
          for (const x of m.simCard) {
            if (!byCard.has(x.source)) byCard.set(x.source, { name: accountName(x.source), items: [], sim: [] });
            byCard.get(x.source).sim.push(x);
          }
          return (
            <div key={m.key}>
              <div className={`yearrow${isOpen ? " open" : ""}`} onClick={() => toggleMonth(m.key)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMonth(m.key); } }}>
                <span className="mname">{isOpen ? "▾" : "▸"} {monthLabel(m.key + "-01")}</span>
                <span className="num pos">{money(m.income)}</span>
                <span className="num">{money(m.spend)}</span>
                <span className="num" style={{ color: m.net < 0 ? "var(--red)" : "var(--green)" }}>{signed(m.net)}</span>
                <span className="num">{money(m.end)}</span>
                <span className="num" style={{ color: m.low < 0 ? "var(--red)" : m.low < 500 ? "var(--amber)" : "var(--mut)" }}>{money(m.low)}</span>
                <span className="when">{shortDate(m.lowDate)}</span>
              </div>
              {isOpen && (
                <div className="monthdetail">
                  <div className="acctblock">
                    <div className="acctname">Checking</div>
                    {m.events.map((e, i) => (
                      <div className="detrow" key={i}>
                        <span className="dt">{shortDate(e.date)}</span>
                        <span className="dn">{e.description}</span>
                        <span className="tag">{EVENT_LABEL[e.type] || e.type}</span>
                        <span className={`amt da ${e.amount >= 0 ? "pos" : ""}`}>{signed(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {[...byCard.entries()].map(([cid, grp]) => {
                    const card = data.cards.find((c) => c.id === cid);
                    const dim = card ? daysInMonth(+m.key.slice(0, 4), +m.key.slice(5, 7)) : 0;
                    const variable = card ? round2(dim * Number(card.dailySpendEstimate || 0)) : 0;
                    const fixedTotal = round2(grp.items.reduce((sm, x) => sm + x.amount, 0));
                    const simTotal = round2(grp.sim.reduce((sm, x) => sm + Number(x.amount), 0));
                    return (
                      <div className="acctblock" key={cid}>
                        <div className="acctname">{grp.name}
                          <span className="when" style={{ marginLeft: 8 }}>
                            fixed {money(fixedTotal)}{variable > 0 ? ` · variable est. ${money(variable)}` : ""}{simTotal > 0 ? ` · simulated ${money(simTotal)}` : ""}
                            {" "}→ {money(round2(fixedTotal + variable + simTotal))} to pay
                          </span>
                        </div>
                        {grp.items.map((c, i) => (
                          <div className="detrow" key={i}>
                            <span className="dt">{shortDate(c.date)}</span>
                            <span className="dn">{c.name}</span>
                            <span className="tag">fixed</span>
                            <span className="amt da">{money(c.amount)}</span>
                          </div>
                        ))}
                        {grp.sim.map((x, i) => (
                          <div className="detrow" key={`s${i}`}>
                            <span className="dt">{shortDate(x.date)}</span>
                            <span className="dn">{x.name}</span>
                            <span className="tag projected">simulated</span>
                            <span className="amt da">{money(x.amount)}</span>
                          </div>
                        ))}
                        {variable > 0 && (
                          <div className="detrow" style={{ opacity: .7 }}>
                            <span className="dt">est.</span>
                            <span className="dn">Daily spending × {dim} days</span>
                            <span className="tag projected">variable</span>
                            <span className="amt da">{money(variable)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {yearEnd && (
          <div className="yearrow total">
            <span className="mname">{year} total</span>
            <span className="num pos">{money(round2(months.filter((m) => !m.empty).reduce((s, m) => s + m.income, 0)))}</span>
            <span className="num">{money(round2(months.filter((m) => !m.empty).reduce((s, m) => s + m.spend, 0)))}</span>
            <span className="num" style={{ color: months.filter((m) => !m.empty).reduce((s, m) => s + m.net, 0) < 0 ? "var(--red)" : "var(--green)" }}>
              {signed(round2(months.filter((m) => !m.empty).reduce((s, m) => s + m.net, 0)))}
            </span>
            <span className="num">{money(yearEnd.end)}</span>
            <span /><span />
          </div>
        )}
      </section>
      )}
      <div className="legend" style={{ marginTop: 10 }}>
        Checking rows are actual cash movements. Card blocks show what accumulates on each statement — fixed charges plus your variable estimate — which arrives in checking as the card payment listed above.
      </div>
    </>
  );
}

/* ---------------- cards screen ---------------- */
function CardForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="formgrid">
      <Field lab="Name"><input value={f.name} onChange={set("name")} /></Field>
      <Field lab="Cycle closes (day)"><input type="number" min="1" max="31" value={f.cycleCloseDay} onChange={set("cycleCloseDay")} /></Field>
      <Field lab="Payment due (day)"><input type="number" min="1" max="31" value={f.paymentDueDay} onChange={set("paymentDueDay")} /></Field>
      <Field lab="Annual fee $"><input type="number" value={f.annualFee} onChange={set("annualFee")} /></Field>
      <Field lab="Fee month (1-12)"><input type="number" min="1" max="12" value={f.annualFeeMonth} onChange={set("annualFeeMonth")} placeholder="—" /></Field>
      <Field lab="Daily spend est. $"><input type="number" value={f.dailySpendEstimate} onChange={set("dailySpendEstimate")} /></Field>
      <div className="when" style={{ gridColumn: "1 / -1", marginTop: -2 }}>
        Balances are set on the card’s cycle panel, not here — that keeps the spending history intact.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <button className="primary" onClick={() => onSave({ ...f,
          cycleCloseDay: +f.cycleCloseDay || 1, paymentDueDay: +f.paymentDueDay || 1,
          annualFee: +f.annualFee || 0, annualFeeMonth: f.annualFeeMonth ? +f.annualFeeMonth : "",
          dailySpendEstimate: +f.dailySpendEstimate || 0 })}>Save</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Cards({ data, setData, today }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const blank = { name: "", cycleCloseDay: 1, paymentDueDay: 25, annualFee: 0, annualFeeMonth: "", currentBalance: 0, balanceAsOf: today, dailySpendEstimate: 0 };
  const hasActivity = (c) => data.rules.some((r) => r.paymentSource === "card" && r.creditCardId === c.id && r.active) || Number(c.dailySpendEstimate) > 0;
  const active = data.cards.filter(hasActivity);
  const quiet = data.cards.filter((c) => !hasActivity(c));
  return (
    <>
      <div className="screenhead"><h1>Cards</h1><button onClick={() => { setAdding(true); setEditing(null); }}>+ Add card</button></div>
      {adding && <section className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">New card</div>
        <CardForm initial={{ ...blank, id: uid() }} onCancel={() => setAdding(false)}
          onSave={(c) => { setData((d) => ({ ...d, cards: [...d.cards, c] })); setAdding(false); }} />
      </section>}
      {active.map((c) => (
        <div key={c.id}>
          <CardCycle card={c} data={data} setData={setData} today={today} />
          <div style={{ margin: "-8px 0 16px", display: "flex", gap: 8 }}>
            <button className="ghost" onClick={() => setEditing(editing === c.id ? null : c.id)}>{editing === c.id ? "Close settings" : "Card settings"}</button>
            <button className="danger-btn" onClick={() => { if (confirm(`Delete ${c.name}?`)) setData((d) => ({ ...d, cards: d.cards.filter((x) => x.id !== c.id) })); }}>Delete</button>
          </div>
          {editing === c.id && <section className="panel" style={{ marginBottom: 16 }}>
            <CardForm initial={c} onCancel={() => setEditing(null)}
              onSave={(nc) => { setData((d) => ({ ...d, cards: d.cards.map((x) => x.id === c.id ? nc : x) })); setEditing(null); }} />
          </section>}
        </div>
      ))}
      {quiet.length > 0 && (
        <section className="panel">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Cards with no fixed charges</div>
          {quiet.map((c) => (
            <div key={c.id}>
              <div className="row">
                <div><span>{c.name}</span><div className="when">closes day {c.cycleCloseDay} · due day {c.paymentDueDay}</div></div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="amt">{money(c.currentBalance)}</span>
                  <button className="ghost" onClick={() => setEditing(editing === c.id ? null : c.id)}>{editing === c.id ? "Close" : "Edit"}</button>
                  <button className="danger-btn" onClick={() => { if (confirm(`Delete ${c.name}?`)) setData((d) => ({ ...d, cards: d.cards.filter((x) => x.id !== c.id) })); }}>✕</button>
                </div>
              </div>
              {editing === c.id && <CardForm initial={c} onCancel={() => setEditing(null)}
                onSave={(nc) => { setData((d) => ({ ...d, cards: d.cards.map((x) => x.id === c.id ? nc : x) })); setEditing(null); }} />}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/* ---------------- spending screen ---------------- */
function Spending({ data, setData, today }) {
  const [addForm, setAddForm] = useState({ name: "", amount: "", count: 1, per: "week" });
  const [obsForm, setObsForm] = useState({ cardId: data.cards[0]?.id || "", balance: "", date: today });
  const [showLog, setShowLog] = useState(false);

  const assumptions = data.assumptions || [];
  const budgetMonthly = round2(assumptions.reduce((s, a) => s + assumptionMonthly(a), 0));
  const budgetDaily = monthlyToDaily(budgetMonthly);

  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = endOfMonth(today);
  const daysThisMonth = daysBetween(monthStart, monthEnd) + 1;

  const mtd = totalVariableSpend(data, monthStart, today);
  const covered = mtd.days;
  const spent = mtd.variable;
  const perDay = mtd.perDay;
  const lastCovered = mtd.per.reduce((m, x) => (cmp(x.to, m) > 0 ? x.to : m), monthStart);
  const daysLeft = Math.max(0, daysBetween(lastCovered, monthEnd));
  const allowance = daysLeft > 0 ? round2((budgetMonthly - spent) / daysLeft) : 0;
  const paceEnd = round2(spent + perDay * daysLeft);
  const overUnder = round2(budgetMonthly - paceEnd);

  // previous months
  const history = useMemo(() => {
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const ms = `${addMonths(monthStart, -i).slice(0, 7)}-01`;
      const me = endOfMonth(ms);
      const r = totalVariableSpend(data, ms, me);
      if (r.per.length && r.days > 0) out.push({ key: ms.slice(0, 7), ...r, budget: budgetMonthly });
    }
    return out;
  }, [data, monthStart, budgetMonthly]);

  const addAssumption = () => {
    if (!addForm.name || !addForm.amount) return;
    setData((d) => ({ ...d, assumptions: [...(d.assumptions || []), { ...addForm, id: uid(), amount: +addForm.amount, count: +addForm.count || 1 }] }));
    setAddForm({ name: "", amount: "", count: 1, per: "week" });
  };
  const updateAssumption = (id, patch) => setData((d) => ({
    ...d, assumptions: (d.assumptions || []).map((a) => a.id === id ? { ...a, ...patch } : a) }));
  const logObservation = () => {
    if (!obsForm.cardId || obsForm.balance === "") return;
    setData((d) => setCardBalance(d, obsForm.cardId, +obsForm.balance, obsForm.date));
    setObsForm({ ...obsForm, balance: "" });
  };
  const applyToForecast = (cardId, rate) => setData((d) => ({
    ...d, cards: d.cards.map((c) => c.id === cardId ? { ...c, dailySpendEstimate: rate } : c) }));

  const pace = perDay > budgetDaily * 1.02 ? "over" : perDay < budgetDaily * 0.98 ? "under" : "on";

  // The forecast rate lives on the cards; the budget lives here. Keep them honest.
  const spendCards = data.cards.filter((c) => Number(c.dailySpendEstimate) > 0);
  const forecastDaily = round2(spendCards.reduce((s, c) => s + Number(c.dailySpendEstimate), 0));
  const inSync = Math.abs(forecastDaily - budgetDaily) < 0.5;
  const syncTarget = spendCards[0] || data.cards[0];
  const syncForecast = () => setData((d) => ({ ...d, cards: d.cards.map((c) =>
    c.id === syncTarget.id ? { ...c, dailySpendEstimate: round2(budgetDaily - (forecastDaily - Number(c.dailySpendEstimate || 0))) } : c) }));

  return (
    <>
      <div className="screenhead">
        <h1>Spending</h1>
        <button className="ghost" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide" : "Log a balance"}</button>
      </div>
      <div style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 16 }}>
        Everything on your cards that isn’t a fixed expense. Each card’s planned balance is subtracted from its actual balance — the remainder is real discretionary spending.
      </div>

      {showLog && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Log a card balance</div>
          <div className="formgrid">
            <Field lab="Card"><select value={obsForm.cardId} onChange={(e) => setObsForm({ ...obsForm, cardId: e.target.value })}>
              {data.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></Field>
            <Field lab="Date"><input type="date" value={obsForm.date} onChange={(e) => setObsForm({ ...obsForm, date: e.target.value })} /></Field>
            <Field lab="Balance $"><input type="number" value={obsForm.balance} onChange={(e) => setObsForm({ ...obsForm, balance: e.target.value })} /></Field>
            <div style={{ display: "flex", alignItems: "end" }}><button className="primary" onClick={logObservation}>Log</button></div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 8 }}>
            The more often you log balances, the sharper the daily average. Two per month is enough; weekly is better.
          </div>
        </section>
      )}

      <div className="statgrid4">
        <section className="panel">
          <div className="eyebrow">Spent this month</div>
          <div className="bignum">{covered ? money(spent) : "—"}</div>
          <div className="when">{covered ? `over ${covered} days` : "needs two balances"}</div>
        </section>
        <section className="panel">
          <div className="eyebrow">Per day so far</div>
          <div className="bignum" style={{ color: pace === "over" ? "var(--red)" : pace === "under" ? "var(--green)" : undefined }}>
            {covered ? money(perDay) : "—"}
          </div>
          <div className="when">budget {money(budgetDaily)}/day</div>
        </section>
        <section className="panel">
          <div className="eyebrow">Left to spend</div>
          <div className="bignum" style={{ color: budgetMonthly - spent < 0 ? "var(--red)" : undefined }}>{money(round2(budgetMonthly - spent))}</div>
          <div className="when">of {money(budgetMonthly)} budget</div>
        </section>
        <section className="panel" style={{ borderColor: allowance < 0 ? "#ebd0c8" : undefined }}>
          <div className="eyebrow">Daily from here</div>
          <div className="bignum" style={{ color: allowance < 0 ? "var(--red)" : allowance < budgetDaily ? "var(--amber)" : "var(--green)" }}>
            {daysLeft > 0 ? money(allowance) : "—"}
          </div>
          <div className="when">{daysLeft} days to month end</div>
        </section>
      </div>

      {covered > 0 && (
        <div className={`notice ${overUnder < 0 ? "bad" : ""}`}>
          <span style={{ fontWeight: 600, color: overUnder < 0 ? "var(--red)" : "var(--green)" }}>
            At {money(perDay)}/day you finish {monthName(today).split(" ")[0]} at {money(paceEnd)}
          </span>
          <span style={{ color: "var(--mut)" }}>
            {overUnder < 0
              ? `${money(Math.abs(overUnder))} over budget — drop to ${money(Math.max(0, allowance))}/day to land on target`
              : `${money(overUnder)} under budget — you have room at ${money(allowance)}/day`}
          </span>
        </div>
      )}

      {syncTarget && (
        <div className={`notice ${inSync ? "" : "bad"}`}>
          {inSync ? (
            <span style={{ color: "var(--green)", fontWeight: 600 }}>
              Forecast matches your budget at {money(forecastDaily)}/day
            </span>
          ) : (
            <>
              <span style={{ fontWeight: 600 }}>
                Your budget says {money(budgetDaily)}/day, the cash-flow forecast assumes {money(forecastDaily)}/day
              </span>
              <button onClick={syncForecast}>Use the budget in the forecast</button>
            </>
          )}
          <span style={{ color: "var(--mut)", fontSize: 12.5 }}>
            applied to {syncTarget.name}
          </span>
        </div>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="grouphead">
          <div><span className="gname">By card, this month</span><div className="when" style={{ marginTop: 1 }}>actual balance change, minus fixed charges, plus payments</div></div>
          <span className="amt" style={{ fontWeight: 600 }}>{money(spent)}</span>
        </div>
        {mtd.per.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13, paddingTop: 8 }}>
          Log at least two balances for a card to measure its spending.
        </div>}
        {mtd.per.map((x) => {
          const rate = x.days > 0 ? round2(x.variable / x.days) : 0;
          const card = data.cards.find((c) => c.id === x.cardId);
          return (
            <div className="row" key={x.cardId}>
              <div style={{ flex: 1 }}>
                <span>{x.cardName}</span>
                <div className="when">
                  {money(x.startBalance)} → {money(x.endBalance)} · {shortDate(x.from)}–{shortDate(x.to)} ·
                  fixed {money(x.fixed)}{x.payments > 0 ? ` · paid ${money(x.payments)}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="amt">{money(x.variable)}</div>
                <div className="when">{money(rate)}/day</div>
              </div>
              {card && Math.abs(rate - Number(card.dailySpendEstimate || 0)) > 1 && (
                <button className="ghost" onClick={() => applyToForecast(x.cardId, rate)} title="Use this rate in the cash-flow forecast">
                  Use {money(rate)}/day
                </button>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="grouphead">
          <div><span className="gname">Assumptions</span><div className="when" style={{ marginTop: 1 }}>what you intend to spend — this sets the budget</div></div>
          <span className="amt" style={{ fontWeight: 600 }}>{money(budgetMonthly)}<span style={{ color: "var(--faint)", fontWeight: 400 }}>/mo</span></span>
        </div>
        {assumptions.map((a) => (
          <div className="asmrow" key={a.id}>
            <input style={{ flex: "2 1 130px" }} value={a.name} onChange={(e) => updateAssumption(a.id, { name: e.target.value })} />
            <input style={{ flex: "0 1 84px" }} type="number" value={a.amount} onChange={(e) => updateAssumption(a.id, { amount: +e.target.value })} />
            <span className="when">×</span>
            <input style={{ flex: "0 1 60px" }} type="number" value={a.count} onChange={(e) => updateAssumption(a.id, { count: +e.target.value })} />
            <select style={{ flex: "0 1 96px" }} value={a.per} onChange={(e) => updateAssumption(a.id, { per: e.target.value })}>
              <option value="day">per day</option><option value="week">per week</option><option value="month">per month</option>
            </select>
            <span className="amt" style={{ minWidth: 92, textAlign: "right" }}>{money(assumptionMonthly(a))}<span style={{ color: "var(--faint)" }}>/mo</span></span>
            <button className="danger-btn" onClick={() => setData((d) => ({ ...d, assumptions: d.assumptions.filter((x) => x.id !== a.id) }))}>✕</button>
          </div>
        ))}
        <div className="asmrow" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
          <input style={{ flex: "2 1 130px" }} placeholder="Groceries" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
          <input style={{ flex: "0 1 84px" }} type="number" placeholder="100" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} />
          <span className="when">×</span>
          <input style={{ flex: "0 1 60px" }} type="number" value={addForm.count} onChange={(e) => setAddForm({ ...addForm, count: e.target.value })} />
          <select style={{ flex: "0 1 96px" }} value={addForm.per} onChange={(e) => setAddForm({ ...addForm, per: e.target.value })}>
            <option value="day">per day</option><option value="week">per week</option><option value="month">per month</option>
          </select>
          <button className="primary" onClick={addAssumption}>Add</button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 10 }}>
          {money(budgetMonthly)}/month is {money(budgetDaily)}/day across {daysThisMonth} days.
        </div>
      </section>

      {history.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Previous months</div>
          {history.map((h) => {
            const rate = round2(h.variable / h.days);
            return (
              <div className="row" key={h.key}>
                <div style={{ flex: 1 }}>
                  <span>{monthName(h.key + "-01")}</span>
                  <div className="when">measured over {h.days} days</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="amt">{money(h.variable)}</div>
                  <div className="when" style={{ color: rate > budgetDaily ? "var(--red)" : "var(--green)" }}>{money(rate)}/day</div>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

/* ---------------- recurring (grouped by payment source) ---------------- */
function RuleForm({ initial, cards, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="formgrid">
      <Field lab="Name"><input value={f.name} onChange={set("name")} /></Field>
      <Field lab="Amount $"><input type="number" value={f.amount} onChange={set("amount")} /></Field>
      <Field lab="Category"><input value={f.category} onChange={set("category")} /></Field>
      <Field lab="Paid from"><select value={f.paymentSource === "checking" ? "checking" : f.creditCardId}
        onChange={(e) => { const v = e.target.value; setF(v === "checking" ? { ...f, paymentSource: "checking", creditCardId: "" } : { ...f, paymentSource: "card", creditCardId: v }); }}>
        <option value="checking">Checking</option>
        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></Field>
      <Field lab="Frequency"><select value={f.frequency} onChange={set("frequency")}>
        {["monthly", "biweekly", "weekly", "quarterly", "yearly"].map((x) => <option key={x} value={x}>{x}</option>)}
      </select></Field>
      <Field lab="Due day"><input type="number" min="1" max="31" value={f.dueDay} onChange={set("dueDay")} /></Field>
      <Field lab="Start date"><input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
      <Field lab="End date (opt.)"><input type="date" value={f.endDate} onChange={set("endDate")} /></Field>
      <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <button className="primary" onClick={() => onSave({ ...f, amount: +f.amount || 0, dueDay: +f.dueDay || 1 })}>Save</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Recurring({ data, setData, embedded }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const blank = { name: "", amount: "", category: "", paymentSource: "checking", creditCardId: "", frequency: "monthly", dueDay: 1, startDate: todayISO(), endDate: "", active: true };

  const groups = [
    { key: "checking", label: "Checking", note: "debited straight from your account",
      rules: data.rules.filter((r) => r.paymentSource === "checking") },
    ...data.cards.map((c) => ({ key: c.id, label: c.name, note: `charged to the card · due day ${c.paymentDueDay}`,
      rules: data.rules.filter((r) => r.paymentSource === "card" && r.creditCardId === c.id) })),
  ].filter((g) => g.rules.length > 0);

  const orphans = data.rules.filter((r) => r.paymentSource === "card" && !data.cards.some((c) => c.id === r.creditCardId));
  if (orphans.length) groups.push({ key: "orphan", label: "Unassigned", note: "card no longer exists", rules: orphans });

  const grandTotal = data.rules.filter((r) => r.active).reduce((s, r) => s + monthlyEquivalent(r), 0);
  const checkingTotal = data.rules.filter((r) => r.active && r.paymentSource === "checking").reduce((s, r) => s + monthlyEquivalent(r), 0);
  const cardTotal = grandTotal - checkingTotal;

  const RuleRow = ({ r }) => (
    <div>
      <div className="row">
        <div>
          <span style={{ opacity: r.active ? 1 : 0.5 }}>{r.name}</span>
          {!r.active && <span className="tag">paused</span>}
          <div className="when">{r.frequency} · day {r.dueDay}{r.category ? ` · ${r.category}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span className="amt">{money(r.amount)}</span>
          <button className="ghost" onClick={() => setData((d) => ({ ...d, rules: d.rules.map((x) => x.id === r.id ? { ...x, active: !x.active } : x) }))}>{r.active ? "Pause" : "Resume"}</button>
          <button className="ghost" onClick={() => { setEditing(editing === r.id ? null : r.id); setAdding(false); }}>{editing === r.id ? "Close" : "Edit"}</button>
          <button className="danger-btn" onClick={() => { if (confirm(`Delete ${r.name}?`)) setData((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) })); }}>✕</button>
        </div>
      </div>
      {editing === r.id && <RuleForm initial={r} cards={data.cards} onCancel={() => setEditing(null)}
        onSave={(nr) => { setData((d) => ({ ...d, rules: d.rules.map((x) => x.id === r.id ? nr : x) })); setEditing(null); }} />}
    </div>
  );

  return (
    <>
      <div className="screenhead" style={{ marginBottom: 10 }}>
        {!embedded && <h1>Recurring</h1>}
        <span style={{ color: "var(--mut)", fontSize: 13.5 }}>Fixed commitments, grouped by where the money leaves from</span>
        <button onClick={() => { setAdding(true); setEditing(null); }}>+ Add</button>
      </div>
      <div className="statgrid" style={{ marginBottom: 16 }}>
        <section className="panel"><div className="eyebrow">From checking</div><div className="bignum">{money(checkingTotal)}</div><div className="when">per month</div></section>
        <section className="panel"><div className="eyebrow">On credit cards</div><div className="bignum">{money(cardTotal)}</div><div className="when">per month</div></section>
        <section className="panel"><div className="eyebrow">Total fixed</div><div className="bignum">{money(grandTotal)}</div><div className="when">per month</div></section>
      </div>
      {adding && <section className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">New recurring expense</div>
        <RuleForm initial={{ ...blank, id: uid() }} cards={data.cards} onCancel={() => setAdding(false)}
          onSave={(r) => { setData((d) => ({ ...d, rules: [...d.rules, r] })); setAdding(false); }} />
      </section>}
      {groups.map((g) => {
        const total = g.rules.filter((r) => r.active).reduce((s, r) => s + monthlyEquivalent(r), 0);
        return (
          <section className="panel" style={{ marginBottom: 16 }} key={g.key}>
            <div className="grouphead">
              <div>
                <span className="gname">{g.label}</span>
                <span className="tag">{g.rules.length}</span>
                <div className="when" style={{ marginTop: 1 }}>{g.note}</div>
              </div>
              <span className="amt" style={{ fontWeight: 600 }}>{money(total)}<span style={{ color: "var(--faint)", fontWeight: 400 }}>/mo</span></span>
            </div>
            {g.rules.map((r) => <RuleRow key={r.id} r={r} />)}
          </section>
        );
      })}
      {groups.length === 0 && <section className="panel"><div style={{ color: "var(--faint)", fontSize: 13 }}>No recurring expenses yet.</div></section>}
    </>
  );
}

/* ---------------- salary calculator modal ---------------- */
function SalaryModal({ data, setData, today, onClose }) {
  const payroll = normalizePayroll(data.payroll);
  const latest = [...data.incomes].sort((a, b) => cmp(b.effectiveDate, a.effectiveDate))[0];
  const currentSalary = latest?.annualSalary || 0;
  const [salary, setSalary] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [openEditor, setOpenEditor] = useState(null);
  const [p, setP] = useState(payroll);

  const cur = currentSalary ? computePaycheck(currentSalary, p) : null;
  const next = salary !== "" && !isNaN(+salary) ? computePaycheck(+salary, p) : null;
  const setP_ = (k) => (e) => setP({ ...p, [k]: e.target.value });

  const Line = ({ label, cur: c, next: n, negative, bold }) => (
    <tr className={bold ? "total" : ""}>
      <td style={{ paddingLeft: bold ? 6 : 14 }}>{label}</td>
      <td className="n" style={{ color: "var(--mut)" }}>{c == null ? "—" : (negative ? `−${money(c)}` : money(c))}</td>
      <td className="n">{n == null ? "—" : (negative ? `−${money(n)}` : money(n))}</td>
    </tr>
  );

  const save = () => {
    if (!next) return;
    setData((d) => ({
      ...d,
      payroll: p,
      incomes: [...d.incomes, {
        id: uid(), effectiveDate, anchorPayDate: latest?.anchorPayDate || today,
        annualSalary: next.annualSalary, gross: next.gross, k401: next.k401, hsa: next.hsa,
        taxes: next.taxes, carDeduction: next.car, carBenefit: 0, netPaycheck: next.net, breakdown: next,
      }],
    }));
    onClose();
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target.classList.contains("overlay")) onClose(); }}>
      <div className="modal">
        <h2>New salary</h2>
        <div style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 14 }}>
          Enter the new annual base salary — every paycheck line is calculated for you, biweekly over 26 periods.
        </div>

        <div className="formgrid" style={{ marginTop: 0, gridTemplateColumns: "1fr 1fr" }}>
          <Field lab="New annual salary $">
            <input type="number" autoFocus value={salary} onChange={(e) => setSalary(e.target.value)} placeholder={currentSalary ? String(currentSalary) : "132000"} />
          </Field>
          <Field lab="Effective from"><input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></Field>
        </div>

        <div className="editrow">
          <button className={`chip ${openEditor === "k401" ? "on" : ""}`} onClick={() => setOpenEditor(openEditor === "k401" ? null : "k401")}>
            401(k) · {p.k401Pct}% pre-tax{Number(p.rothPct) > 0 ? ` + ${p.rothPct}% Roth` : ""}
          </button>
          <button className={`chip ${openEditor === "car" ? "on" : ""}`} onClick={() => setOpenEditor(openEditor === "car" ? null : "car")}>
            Car · {money0(p.carMonthly)}/mo payment · {money0(p.stipendMonthly)}/mo stipend
          </button>
        </div>

        {openEditor === "k401" && (
          <div className="editor">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Retirement contributions</div>
            <div className="formgrid" style={{ marginTop: 0 }}>
              <Field lab="Pre-tax 401(k) %"><input type="number" step="0.5" value={p.k401Pct} onChange={setP_("k401Pct")} /></Field>
              <Field lab="Roth 401(k) %"><input type="number" step="0.5" value={p.rothPct} onChange={setP_("rothPct")} /></Field>
              <Field lab="Employer match %"><input type="number" step="0.5" value={p.matchPct} onChange={setP_("matchPct")} /></Field>
            </div>
            {next && (
              <div className="editnote">
                Pre-tax <b className="num">{money(next.k401)}</b>/check reduces taxable income · Roth <b className="num">{money(next.roth)}</b>/check does not ·
                employer adds <b className="num">{money(next.match)}</b>/check.
                <br />Annual into the plan: <b className="num">{money0((next.k401 + next.roth + next.match) * PERIODS)}</b>
                {" "}(yours {money0((next.k401 + next.roth) * PERIODS)}).
                {(next.k401 + next.roth) * PERIODS > 24500 && <span className="danger"> Above the {money0(24500)} employee deferral limit.</span>}
              </div>
            )}
          </div>
        )}

        {openEditor === "car" && (
          <div className="editor">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Company car — enter monthly, converted to biweekly</div>
            <div className="formgrid" style={{ marginTop: 0 }}>
              <Field lab="Car payment $/month"><input type="number" value={p.carMonthly} onChange={setP_("carMonthly")} /></Field>
              <Field lab="Stipend $/month"><input type="number" value={p.stipendMonthly} onChange={setP_("stipendMonthly")} /></Field>
            </div>
            <div className="editnote">
              × 12 ÷ 26 → payment <b className="num">{money(perCheck(p.carMonthly))}</b>/check (post-tax) ·
              stipend <b className="num">{money(perCheck(p.stipendMonthly))}</b>/check (taxable earnings).
              <br />Net monthly cost of the car after the stipend is taxed:{" "}
              <b className="num">{money(round2(Number(p.carMonthly) - perMonth(perCheck(p.stipendMonthly) * (next ? (1 - (next.taxes / next.gross)) : 0.65))))}</b>
              {" "}<span style={{ color: "var(--faint)" }}>approx.</span>
            </div>
          </div>
        )}

        {next && (
          <>
            <table className="paytable">
              <thead>
                <tr><th>Line item</th><th>Now{cur ? ` · ${money0(currentSalary)}` : ""}</th><th>New · {money0(next.annualSalary)}</th></tr>
              </thead>
              <tbody>
                <tr className="sect"><td colSpan={3}>Earnings</td></tr>
                <Line label="Regular (base ÷ 26)" cur={cur?.regular} next={next.regular} />
                <Line label={`Stipend (${money0(p.stipendMonthly)}/mo)`} cur={cur?.stipend} next={next.stipend} />
                <Line label="Gross pay" cur={cur?.gross} next={next.gross} bold />
                <tr className="sect"><td colSpan={3}>Statutory deductions</td></tr>
                <Line label="Federal income tax" cur={cur?.fed} next={next.fed} negative />
                <Line label="Social Security" cur={cur?.ss} next={next.ss} negative />
                <Line label="Medicare" cur={cur?.medicare} next={next.medicare} negative />
                <Line label="VA state income tax" cur={cur?.state} next={next.state} negative />
                <tr className="sect"><td colSpan={3}>Pre-tax benefits</td></tr>
                <Line label={`401(k) — ${p.k401Pct}% of base`} cur={cur?.k401} next={next.k401} negative />
                <Line label="HSA" cur={cur?.hsa} next={next.hsa} negative />
                <Line label="Medical" cur={cur?.medical} next={next.medical} negative />
                <Line label="Dental" cur={cur?.dental} next={next.dental} negative />
                <Line label="Vision" cur={cur?.vision} next={next.vision} negative />
                <tr className="sect"><td colSpan={3}>Post-tax deductions</td></tr>
                {(Number(p.rothPct) > 0 || (cur && cur.roth > 0)) &&
                  <Line label={`Roth 401(k) — ${p.rothPct}% of base`} cur={cur?.roth} next={next.roth} negative />}
                <Line label={`Company car (${money0(p.carMonthly)}/mo)`} cur={cur?.car} next={next.car} negative />
                <Line label="Legal services" cur={cur?.legal} next={next.legal} negative />
                <Line label="Hospital care" cur={cur?.hospital} next={next.hospital} negative />
                <Line label="Critical illness" cur={cur?.critical} next={next.critical} negative />
                <Line label="Accident injury" cur={cur?.accident} next={next.accident} negative />
                <Line label="Net pay" cur={cur?.net} next={next.net} bold />
              </tbody>
            </table>
            {cur && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg)", border: "1px solid var(--line-soft)", borderRadius: 10, fontSize: 13.5 }}>
                <b className={next.net >= cur.net ? "pos" : "danger"}>{signed(round2(next.net - cur.net))} per check</b>
                <span style={{ color: "var(--mut)" }}> · {signed(round2((next.net - cur.net) * 26))} per year · federal taxable income {money0(next.fedAnnualTaxable)}</span>
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <button className="ghost" style={{ fontSize: 12.5, padding: "4px 0" }} onClick={() => setShowAssumptions(!showAssumptions)}>
                {showAssumptions ? "Hide" : "Show"} assumptions & flat deductions
              </button>
              {showAssumptions && (
                <div className="formgrid">
                  <Field lab="HSA"><input type="number" value={p.hsa} onChange={setP_("hsa")} /></Field>
                  <Field lab="Medical"><input type="number" value={p.medical} onChange={setP_("medical")} /></Field>
                  <Field lab="Dental"><input type="number" value={p.dental} onChange={setP_("dental")} /></Field>
                  <Field lab="Vision"><input type="number" value={p.vision} onChange={setP_("vision")} /></Field>
                  <Field lab="Legal"><input type="number" value={p.legal} onChange={setP_("legal")} /></Field>
                  <Field lab="Hospital"><input type="number" value={p.hospital} onChange={setP_("hospital")} /></Field>
                  <Field lab="Critical illness"><input type="number" value={p.critical} onChange={setP_("critical")} /></Field>
                  <Field lab="Accident"><input type="number" value={p.accident} onChange={setP_("accident")} /></Field>
                  <Field lab="Imputed life"><input type="number" value={p.imputedLife} onChange={setP_("imputedLife")} /></Field>
                  <Field lab="Extra federal"><input type="number" value={p.extraFed} onChange={setP_("extraFed")} /></Field>
                  <Field lab="Extra state"><input type="number" value={p.extraState} onChange={setP_("extraState")} /></Field>
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
                Single filer, Virginia, 26 pay periods. Federal uses the standard deduction and current brackets; FICA excludes Section 125 items but includes 401(k) and imputed life. Models withholding, not your final filing.
              </div>
            </div>
          </>
        )}

        <div className="modalfoot">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!next} onClick={save}>
            {next ? `Save — ${money(next.net)} per check` : "Enter a salary"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- income screen ---------------- */
function Income({ data, setData, today, embedded }) {
  const [showSalary, setShowSalary] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const blank = { effectiveDate: today, anchorPayDate: data.incomes[0]?.anchorPayDate || today, netPaycheck: "", annualSalary: "" };
  const [f, setF] = useState(blank);
  const sorted = [...data.incomes].sort((a, b) => cmp(b.effectiveDate, a.effectiveDate));

  return (
    <>
      <div className="screenhead">
        {!embedded && <h1>Income</h1>}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button className="ghost" onClick={() => { setShowManual(!showManual); }}>Manual entry</button>
          <button className="primary" onClick={() => setShowSalary(true)}>+ New salary</button>
        </div>
      </div>
      <div style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 14 }}>
        Paid biweekly. Enter a new annual salary and the paycheck lines are calculated for you; the profile takes effect on its date and every later paycheck uses it automatically.
      </div>

      {showManual && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Manual profile — set the net directly</div>
          <div className="formgrid">
            <Field lab="Effective date"><input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></Field>
            <Field lab="Anchor payday"><input type="date" value={f.anchorPayDate} onChange={(e) => setF({ ...f, anchorPayDate: e.target.value })} /></Field>
            <Field lab="Annual salary $ (opt.)"><input type="number" value={f.annualSalary} onChange={(e) => setF({ ...f, annualSalary: e.target.value })} /></Field>
            <Field lab="Net paycheck $"><input type="number" value={f.netPaycheck} onChange={(e) => setF({ ...f, netPaycheck: e.target.value })} /></Field>
            <div style={{ display: "flex", alignItems: "end" }}>
              <button className="primary" disabled={!f.netPaycheck} onClick={() => {
                setData((d) => ({ ...d, incomes: [...d.incomes, { ...f, id: uid(), netPaycheck: +f.netPaycheck, annualSalary: +f.annualSalary || 0 }] }));
                setF(blank); setShowManual(false);
              }}>Save</button>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        {sorted.map((p, i) => (
          <div className="row" key={p.id}>
            <div>
              <span style={{ fontWeight: i === 0 ? 600 : 400 }}>
                {p.annualSalary ? money0(p.annualSalary) : "Manual profile"}
              </span>
              {i === 0 && <span className="tag good">current</span>}
              <div className="when">
                effective {shortDate(p.effectiveDate)} {p.effectiveDate.slice(0, 4)}
                {p.breakdown ? ` · gross ${money(p.gross)} · tax ${money(p.taxes)} · 401k ${money(p.k401)}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="amt pos">{money(p.netPaycheck)}</span>
              {data.incomes.length > 1 && <button className="danger-btn" onClick={() => { if (confirm("Delete this profile?")) setData((d) => ({ ...d, incomes: d.incomes.filter((x) => x.id !== p.id) })); }}>✕</button>}
            </div>
          </div>
        ))}
      </section>

      {showSalary && <SalaryModal data={data} setData={setData} today={today} onClose={() => setShowSalary(false)} />}
    </>
  );
}

/** Per-paycheck contribution lines for retirement / HSA, taken from the current salary. */
function contributionDetail(kind, incomes) {
  const latest = [...(incomes || [])].sort((a, b) => cmp(b.effectiveDate, a.effectiveDate))[0];
  const b = latest && latest.breakdown;
  if (!b) return null;
  if (kind === "retirement") {
    const lines = [
      { label: "Pre-tax 401(k)", perCheck: Number(b.k401 || 0) },
      { label: "Roth 401(k)", perCheck: Number(b.roth || 0) },
      { label: "Employer match", perCheck: Number(b.match || 0) },
    ].filter((l) => l.perCheck > 0);
    return { lines, salary: latest.annualSalary };
  }
  if (kind === "hsa") {
    const lines = [{ label: "Payroll HSA", perCheck: Number(b.hsa || 0) }].filter((l) => l.perCheck > 0);
    return { lines, salary: latest.annualSalary };
  }
  return null;
}

/* ---------------- wealth screen ---------------- */
function AssetForm({ initial, incomes, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const auto = contributionFor({ ...f, contributionOverride: "" }, incomes);
  return (
    <div className="formgrid">
      <Field lab="Name"><input value={f.name} onChange={set("name")} /></Field>
      <Field lab="Type"><select value={f.kind} onChange={set("kind")}>
        {ASSET_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select></Field>
      <Field lab="Balance $"><input type="number" value={f.balance} onChange={set("balance")} /></Field>
      <Field lab="As of"><input type="date" value={f.asOf} onChange={set("asOf")} /></Field>
      <Field lab="Return %/yr"><input type="number" step="0.1" value={f.annualReturnPct} onChange={set("annualReturnPct")} /></Field>
      <Field lab={`Contribution $/mo${auto > 0 ? ` (auto ${money(auto)})` : ""}`}>
        <input type="number" value={f.contributionOverride} onChange={set("contributionOverride")} placeholder={auto ? auto.toFixed(2) : "0"} />
      </Field>
      <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <button className="primary" onClick={() => onSave({ ...f, balance: +f.balance || 0, annualReturnPct: +f.annualReturnPct || 0,
          contributionOverride: f.contributionOverride === "" ? "" : +f.contributionOverride })}>Save</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Wealth({ data, setData, projection, today }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [withReturns, setWithReturns] = useState(false);
  const assets = data.assets || [];
  const blank = { name: "", kind: "savings", balance: 0, asOf: today, annualReturnPct: 4, contributionOverride: "" };
  const MONTHS_OUT = 60;

  const rows = assets.map((a) => {
    const contrib = contributionFor(a, data.incomes);
    return {
      asset: a, contrib,
      series: projectAsset(a, contrib, MONTHS_OUT, withReturns),
      detail: contributionDetail(a.kind, data.incomes),
    };
  });
  const featured = rows.filter((r) => r.asset.kind === "retirement" || r.asset.kind === "hsa");
  const others = rows.filter((r) => !(r.asset.kind === "retirement" || r.asset.kind === "hsa"));

  const cardDebt = round2(data.cards.reduce((s, c) => s + (Number(c.currentBalance) || 0), 0));
  const checkingNow = projection.days.find((d) => d.date === today)?.endBalance ?? data.anchor.balance;
  const assetsNow = round2(rows.reduce((s, r) => s + (Number(r.asset.balance) || 0), 0));
  const netNow = round2(checkingNow + assetsNow - cardDebt);
  const contribTotal = round2(rows.reduce((s, r) => s + r.contrib, 0));
  const checkingAt = (y) => projection.days[Math.min(365 * y, projection.days.length - 1)]?.endBalance ?? 0;
  const assetsAt = (y) => round2(rows.reduce((s, r) => s + r.series[Math.min(y * 12, MONTHS_OUT)], 0));
  const netAt = (y) => round2(checkingAt(y) + assetsAt(y) - cardDebt);

  const HORIZONS = [1, 2, 3, 5];

  const updateBalance = (id, v) => setData((d) => ({ ...d,
    assets: d.assets.map((x) => x.id === id ? { ...x, balance: +v || 0, asOf: today } : x) }));

  const Featured = ({ r }) => {
    const a = r.asset;
    const yearly = round2(r.contrib * 12);
    const limit = a.kind === "retirement" ? 24500 : 4400;   // employee/self-only annual guides
    const ownYearly = r.detail
      ? round2(r.detail.lines.filter((l) => l.label !== "Employer match").reduce((s, l) => s + l.perCheck, 0) * PERIODS)
      : yearly;
    return (
      <section className="panel featured">
        <div className="cyclehead">
          <h2>{a.name}</h2>
          <span className="tag">{a.kind === "retirement" ? "401(k)" : "HSA"}</span>
        </div>
        <div className="fbal">
          <div>
            <div className="eyebrow">Balance today</div>
            <div style={{ display: "flex", gap: 7, marginTop: 4, alignItems: "center" }}>
              <input type="number" value={a.balance} onChange={(e) => updateBalance(a.id, e.target.value)} style={{ fontSize: 20, maxWidth: 170 }} />
            </div>
            <div className="when" style={{ marginTop: 3 }}>as of {shortDate(a.asOf)} {a.asOf.slice(0, 4)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="eyebrow">Going in</div>
            <div className="bignum pos" style={{ fontSize: 22 }}>{money(r.contrib)}</div>
            <div className="when">per month · {money(yearly)}/yr</div>
          </div>
        </div>

        {r.detail && r.detail.lines.length > 0 ? (
          <>
            <div className="eyebrow" style={{ marginTop: 12, marginBottom: 2 }}>From your paycheck</div>
            {r.detail.lines.map((l, i) => (
              <div className="detrow" key={i} style={{ gridTemplateColumns: "1fr auto auto" }}>
                <span className="dn">{l.label}</span>
                <span className="amt da" style={{ minWidth: 84 }}>{money(l.perCheck)}<span style={{ color: "var(--faint)" }}>/check</span></span>
                <span className="amt da" style={{ minWidth: 92 }}>{money(round2(l.perCheck * PERIODS / 12))}<span style={{ color: "var(--faint)" }}>/mo</span></span>
              </div>
            ))}
            <div className="when" style={{ marginTop: 6 }}>
              your own contributions {money(ownYearly)}/yr of the {money(limit)} annual limit
              {ownYearly > limit && <span className="danger"> — over</span>}
            </div>
          </>
        ) : (
          <div className="when" style={{ marginTop: 12 }}>No paycheck data — set a contribution under Edit.</div>
        )}

        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 4 }}>
          Projected from contributions{withReturns ? ` + ${a.annualReturnPct}% return` : " alone"}
        </div>
        {HORIZONS.map((y) => (
          <div className="detrow" key={y} style={{ gridTemplateColumns: "1fr auto auto" }}>
            <span className="dn">In {y} year{y > 1 ? "s" : ""}</span>
            <span className="when" style={{ textAlign: "right" }}>+{money(round2(r.series[y * 12] - a.balance))}</span>
            <span className="amt da" style={{ minWidth: 104, fontSize: 14 }}>{money(r.series[y * 12])}</span>
          </div>
        ))}
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button className="ghost" onClick={() => { setEditing(editing === a.id ? null : a.id); setAdding(false); }}>
            {editing === a.id ? "Close" : "Edit"}
          </button>
        </div>
        {editing === a.id && <AssetForm initial={a} incomes={data.incomes} onCancel={() => setEditing(null)}
          onSave={(na) => { setData((d) => ({ ...d, assets: d.assets.map((x) => x.id === a.id ? na : x) })); setEditing(null); }} />}
      </section>
    );
  };

  return (
    <>
      <div className="screenhead">
        <h1>Wealth</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <label style={{ fontSize: 12.5, color: "var(--mut)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={withReturns} onChange={(e) => setWithReturns(e.target.checked)} style={{ width: "auto" }} />
            include investment returns
          </label>
          <button onClick={() => { setAdding(true); setEditing(null); }}>+ Add account</button>
        </div>
      </div>
      <div style={{ color: "var(--mut)", fontSize: 13.5, marginBottom: 16 }}>
        {withReturns
          ? "Balances grow by contributions and each account’s assumed return, compounded monthly."
          : "Balances grow by contributions only — no market returns assumed, so these are the floor, not a forecast."}
      </div>

      <div className="statgrid">
        <section className="panel"><div className="eyebrow">Net worth today</div><div className="bignum">{money(netNow)}</div><div className="when">checking + accounts − card debt</div></section>
        <section className="panel"><div className="eyebrow">Contributions</div><div className="bignum pos">{money(contribTotal)}</div><div className="when">per month, from your salary</div></section>
        <section className="panel"><div className="eyebrow">Net worth in 5 years</div><div className="bignum">{money(netAt(5))}</div><div className="when">{signed(round2(netAt(5) - netNow))}</div></section>
      </div>

      {adding && <section className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">New account</div>
        <AssetForm initial={{ ...blank, id: uid() }} incomes={data.incomes} onCancel={() => setAdding(false)}
          onSave={(a) => { setData((d) => ({ ...d, assets: [...(d.assets || []), a] })); setAdding(false); }} />
      </section>}

      <div className="grid2">
        {featured.map((r) => <Featured key={r.asset.id} r={r} />)}
      </div>

      {others.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div><span className="gname">Other accounts</span></div>
            <span className="amt" style={{ fontWeight: 600 }}>{money(round2(others.reduce((s, r) => s + Number(r.asset.balance), 0)))}</span>
          </div>
          {others.map(({ asset: a, contrib, series }) => (
            <div key={a.id}>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <span>{a.name}</span>
                  <span className="tag">{(ASSET_KINDS.find((k) => k[0] === a.kind) || [])[1] || a.kind}</span>
                  <div className="when">{contrib > 0 ? `${money(contrib)}/mo · ` : ""}→ {money(series[60])} in 5y</div>
                </div>
                <span className="amt">{money(a.balance)}</span>
                <button className="ghost" onClick={() => { setEditing(editing === a.id ? null : a.id); setAdding(false); }}>{editing === a.id ? "Close" : "Edit"}</button>
                <button className="danger-btn" onClick={() => { if (confirm(`Remove ${a.name}?`)) setData((d) => ({ ...d, assets: d.assets.filter((x) => x.id !== a.id) })); }}>✕</button>
              </div>
              {editing === a.id && <AssetForm initial={a} incomes={data.incomes} onCancel={() => setEditing(null)}
                onSave={(na) => { setData((d) => ({ ...d, assets: d.assets.map((x) => x.id === a.id ? na : x) })); setEditing(null); }} />}
            </div>
          ))}
        </section>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Everything together</div>
        <div className="yearhead" style={{ gridTemplateColumns: "1fr repeat(5,1fr)" }}>
          <span>Horizon</span><span>Checking</span>
          {featured.map((r) => <span key={r.asset.id}>{r.asset.kind === "retirement" ? "401(k)" : "HSA"}</span>)}
          <span>Other</span><span>Net worth</span>
        </div>
        {[0, ...HORIZONS].map((y) => (
          <div className="yearrow" style={{ gridTemplateColumns: "1fr repeat(5,1fr)", cursor: "default" }} key={y}>
            <span className="mname">{y === 0 ? "Today" : `In ${y} year${y > 1 ? "s" : ""}`}</span>
            <span className="num">{money(y === 0 ? checkingNow : checkingAt(y))}</span>
            {featured.map((r) => <span className="num" key={r.asset.id}>{money(r.series[y * 12])}</span>)}
            <span className="num">{money(round2(others.reduce((s, r) => s + r.series[y * 12], 0)))}</span>
            <span className="num pos" style={{ fontWeight: y === 5 ? 600 : 400 }}>{money(y === 0 ? netNow : netAt(y))}</span>
          </div>
        ))}
        <div className="legend">
          {withReturns
            ? "Returns are assumptions, not promises — the contributions-only view is the number you can actually count on."
            : "Contributions only. Any market return is upside on top of these figures — tick the box above to model it."}
        </div>
      </section>
    </>
  );
}

/* ---------------- setup ---------------- */
function Setup({ data, setData, today }) {
  const [tab, setTab] = useState("recurring");
  return (
    <>
      <div className="screenhead">
        <h1>Setup</h1>
        <div className="rbtns">
          <button className={tab === "recurring" ? "active" : "ghost"} onClick={() => setTab("recurring")}>Recurring</button>
          <button className={tab === "income" ? "active" : "ghost"} onClick={() => setTab("income")}>Income</button>
        </div>
      </div>
      {tab === "recurring" ? <Recurring data={data} setData={setData} embedded />
        : <Income data={data} setData={setData} today={today} embedded />}
    </>
  );
}

/* ---------------- shell ---------------- */
const SCREENS = [["dashboard", "Today"], ["year", "Year"], ["cards", "Cards"], ["spending", "Spending"], ["wealth", "Wealth"], ["setup", "Setup"]];

export default function CashflowApp({ session }) {
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const today = todayISO();

  const saveTimer = useRef(null);
  useEffect(() => {
    let alive = true;
    loadCashflow(session.user.id).then((d) => { if (alive) setData(d || seedData()); });
    return () => { alive = false; };
  }, [session.user.id]);

  useEffect(() => {
    if (!data) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveCashflow(session.user.id, data), 600);
    return () => clearTimeout(saveTimer.current);
  }, [data, session.user.id]);

  const activeSims = useMemo(() => (data?.simulations || []).filter((x) => x.active), [data]);
  const simTxs = useMemo(() => activeSims.filter((x) => x.source === "checking").map((x) => ({
    id: `sim-${x.id}`, date: x.date, amount: -Math.abs(Number(x.amount)), type: "one_time_expense",
    status: "scheduled", description: `${x.name} (simulated)`,
  })), [activeSims]);

  const baseArgs = data && {
    anchor: data.anchor, today, horizonEnd: addDays(today, 366 * 5),
    viewStart: `${today.slice(0, 7)}-01`,
    rules: data.rules, incomes: data.incomes, cards: data.cards,
  };
  const baseline = useMemo(() => data && project({ ...baseArgs, transactions: data.transactions }), [data, today]);
  const projection = useMemo(() => data && project({
    ...baseArgs, transactions: [...data.transactions, ...simTxs], simCardCharges: activeSims,
  }), [data, today, simTxs, activeSims]);

  if (!data || !projection || !baseline) return (
    <div className="cf-root" style={{ alignItems: "center", justifyContent: "center" }}>
<div className="eyebrow">Loading…</div>
    </div>
  );

  return (
    <div className="cf-root">
      <nav className="side">
        <a className="wordmark" href="/" title="All apps">sebs<span>.</span>cashflow</a>
        {SCREENS.map(([id, label]) => (
          <button key={id} className={`navbtn ${screen === id ? "on" : ""}`} onClick={() => setScreen(id)}>{label}</button>
        ))}
        <div style={{ marginTop: "auto", padding: "0 8px" }}>
          <div className="when">{shortDate(today)} {today.slice(0, 4)}</div>
          <button className="ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => { if (confirm("Reset all data to the demo seed?")) setData(seedData()); }}>Reset demo data</button>
        </div>
      </nav>
      <main className="main">
        {screen === "dashboard" && <Dashboard data={data} setData={setData} projection={projection} today={today} />}
        {screen === "year" && <Year data={data} setData={setData} projection={projection} baseline={baseline} today={today} />}
        {screen === "cards" && <Cards data={data} setData={setData} today={today} />}
        {screen === "spending" && <Spending data={data} setData={setData} today={today} />}
        {screen === "wealth" && <Wealth data={data} setData={setData} projection={projection} today={today} />}
        {screen === "setup" && <Setup data={data} setData={setData} today={today} />}
      </main>
    </div>
  );
}
