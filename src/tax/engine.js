// EOY prediction from the ledger + latest payslip. Estimate only.
const round2 = (n) => Math.round(n * 100) / 100
const FED_STD = 15000
const FED_BR = [[0,0.10],[11925,0.12],[48475,0.22],[103350,0.24],[197300,0.32],[250525,0.35],[626350,0.37]]
const VA_STD = 8500
const VA_BR = [[0,0.02],[3000,0.03],[5000,0.05],[17000,0.0575]]
function fromBrackets(t, br){ if(t<=0)return 0; let x=0; for(let i=0;i<br.length;i++){const[f,r]=br[i];const c=i+1<br.length?br[i+1][0]:Infinity; if(t>f)x+=(Math.min(t,c)-f)*r; else break;} return x }

export function summarise(entries) {
  const llcIncome = [], llcExpense = [], w2Income = []
  for (const e of entries) {
    const amt = Number(e.amount) || 0
    if (e.book === 'w2' && e.direction === 'income') w2Income.push(e)
    else if (e.book === 'llc' && e.direction === 'income') llcIncome.push(e)
    else if (e.book === 'llc' && e.direction === 'expense') llcExpense.push(e)
  }
  const sum = (a) => round2(a.reduce((s, e) => s + (Number(e.amount) || 0), 0))
  return {
    llcIncomeYTD: sum(llcIncome), llcExpenseYTD: sum(llcExpense),
    llcNetYTD: round2(sum(llcIncome) - sum(llcExpense)),
    w2IncomeYTD: sum(w2Income),
    latestPayslip: [...w2Income].filter((e) => e.fed_withheld != null || e.ytd_gross != null)
      .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))[0] || null,
    counts: { llcIncome: llcIncome.length, llcExpense: llcExpense.length, w2Income: w2Income.length },
  }
}

// EOY: annualise the latest payslip for W-2; use YTD LLC net (optionally
// annualised) as the Schedule C figure. Loss offsets W-2 income.
export function predictEOY(s, opts = {}) {
  const p = s.latestPayslip
  if (!p) return null
  const periods = Number(p.periods_per_year) || 26
  const gross = Number(p.amount) || 0
  const pretax = Number(p.pretax) || 0
  const perFed = Number(p.fed_withheld) || 0
  const perState = Number(p.state_withheld) || 0

  // If the payslip carries YTD figures, use them as banked actuals and project
  // only the checks that remain. This beats annualising one check because it
  // captures raises, bonuses and mid-year changes already reflected in YTD.
  const hasYTD = p.ytd_gross != null
  let annualGross, annualPretax, fedW, stateW, method
  if (hasYTD) {
    const ytdGross = Number(p.ytd_gross) || 0
    const ytdPretax = Number(p.ytd_pretax) || 0
    const ytdFed = Number(p.ytd_fed) || 0
    const ytdState = Number(p.ytd_state) || 0
    // how many checks are already banked, and how many remain
    const done = Number(p.check_number) || Math.max(1, Math.round(ytdGross / (gross || 1)))
    const remaining = Math.max(0, periods - done)
    annualGross = round2(ytdGross + gross * remaining)
    annualPretax = round2(ytdPretax + pretax * remaining)
    fedW = round2(ytdFed + perFed * remaining)
    stateW = round2(ytdState + perState * remaining)
    method = { basis: 'ytd', done, remaining }
  } else {
    annualGross = round2(gross * periods)
    annualPretax = round2(pretax * periods)
    fedW = round2(perFed * periods)
    stateW = round2(perState * periods)
    method = { basis: 'annualised', done: null, remaining: null }
  }
  const w2Taxable = Math.max(0, round2(annualGross - annualPretax))

  // LLC net for the year: annualise YTD if requested, else use YTD as-is
  const llcNet = opts.annualiseLLC && opts.monthsElapsed
    ? round2(s.llcNetYTD * 12 / opts.monthsElapsed)
    : s.llcNetYTD

  const seBase = llcNet > 0 ? round2(llcNet * 0.9235) : 0
  const seTax = round2(seBase * 0.153)
  const halfSE = round2(seTax / 2)
  const agi = round2(w2Taxable + llcNet - halfSE)
  const fedTax = round2(fromBrackets(Math.max(0, agi - FED_STD), FED_BR) + seTax)
  const stateTax = round2(fromBrackets(Math.max(0, w2Taxable + llcNet - VA_STD), VA_BR))
  const refund = round2((fedW + stateW) - (fedTax + stateTax))
  return {
    w2Taxable, w2Gross: annualGross, llcNet, seTax, agi, method,
    fedWithheld: fedW, stateWithheld: stateW,
    fedLiability: fedTax, stateLiability: stateTax,
    totalWithheld: round2(fedW + stateW), totalLiability: round2(fedTax + stateTax),
    refund, owes: refund < 0,
  }
}
