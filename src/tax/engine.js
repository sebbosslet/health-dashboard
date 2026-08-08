// EOY prediction from the ledger + latest payslip. Estimate only.
const round2 = (n) => Math.round(n * 100) / 100
const FED_STD = 15000
const FED_BR = [[0,0.10],[11925,0.12],[48475,0.22],[103350,0.24],[197300,0.32],[250525,0.35],[626350,0.37]]
const VA_STD = 8500
const VA_BR = [[0,0.02],[3000,0.03],[5000,0.05],[17000,0.0575]]
function fromBrackets(t, br){ if(t<=0)return 0; let x=0; for(let i=0;i<br.length;i++){const[f,r]=br[i];const c=i+1<br.length?br[i+1][0]:Infinity; if(t>f)x+=(Math.min(t,c)-f)*r; else break;} return x }

// Same maths, but returns each filled bracket so the UI can show the build-up.
function bracketDetail(t, br){
  const rows=[]; if(t<=0)return rows
  for(let i=0;i<br.length;i++){
    const[f,r]=br[i]; const c=i+1<br.length?br[i+1][0]:Infinity
    if(t<=f)break
    const amt=Math.min(t,c)-f
    rows.push({ from:f, to:c===Infinity?null:c, rate:r, amount:Math.round(amt*100)/100, tax:Math.round(amt*r*100)/100 })
  }
  return rows
}

export function summarise(entries) {
  const llcIncome = [], llcExpense = [], w2Income = []
  for (const e of entries) {
    const amt = Number(e.amount) || 0
    if (e.book === 'w2' && e.direction === 'income') w2Income.push(e)
    else if (e.book === 'llc' && e.direction === 'income') llcIncome.push(e)
    else if (e.book === 'llc' && e.direction === 'expense') llcExpense.push(e)
  }
  const sum = (a) => round2(a.reduce((s, e) => s + (Number(e.amount) || 0), 0))
  const latestWithYTD = [...w2Income].filter((e) => e.ytd_gross != null)
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))[0]
  // W-2 income YTD: the payslip's own YTD gross is the truth when available,
  // otherwise fall back to summing the individual payslip lines on file.
  const w2IncomeYTD = latestWithYTD ? round2(Number(latestWithYTD.ytd_gross)) : sum(w2Income)
  return {
    llcIncomeYTD: sum(llcIncome), llcExpenseYTD: sum(llcExpense),
    llcNetYTD: round2(sum(llcIncome) - sum(llcExpense)),
    w2IncomeYTD,
    w2FromYTD: !!latestWithYTD,
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
  // Three-part split for every W-2 figure: banked YTD, projected rest-of-year, full year.
  let ytd, roy, method
  if (hasYTD) {
    const done = Number(p.check_number) || Math.max(1, Math.round((Number(p.ytd_gross) || 0) / (gross || 1)))
    const remaining = Math.max(0, periods - done)
    ytd = { gross: Number(p.ytd_gross) || 0, pretax: Number(p.ytd_pretax) || 0, fed: Number(p.ytd_fed) || 0, state: Number(p.ytd_state) || 0 }
    roy = { gross: round2(gross * remaining), pretax: round2(pretax * remaining), fed: round2(perFed * remaining), state: round2(perState * remaining) }
    method = { basis: 'ytd', done, remaining }
  } else {
    // No YTD on file — treat the whole year as projection from this one check.
    ytd = { gross: 0, pretax: 0, fed: 0, state: 0 }
    roy = { gross: round2(gross * periods), pretax: round2(pretax * periods), fed: round2(perFed * periods), state: round2(perState * periods) }
    method = { basis: 'annualised', done: 0, remaining: periods }
  }
  const full = {
    gross: round2(ytd.gross + roy.gross), pretax: round2(ytd.pretax + roy.pretax),
    fed: round2(ytd.fed + roy.fed), state: round2(ytd.state + roy.state),
  }
  const annualGross = full.gross, annualPretax = full.pretax, fedW = full.fed, stateW = full.state
  const w2Taxable = Math.max(0, round2(annualGross - annualPretax))

  // LLC net for the year: annualise YTD if requested, else use YTD as-is
  const llcNet = opts.annualiseLLC && opts.monthsElapsed
    ? round2(s.llcNetYTD * 12 / opts.monthsElapsed)
    : s.llcNetYTD

  const seBase = llcNet > 0 ? round2(llcNet * 0.9235) : 0
  const seTax = round2(seBase * 0.153)
  const halfSE = round2(seTax / 2)
  const agi = round2(w2Taxable + llcNet - halfSE)

  const fedTaxableIncome = Math.max(0, round2(agi - FED_STD))
  const fedIncomeTax = round2(fromBrackets(fedTaxableIncome, FED_BR))
  const fedBrackets = bracketDetail(fedTaxableIncome, FED_BR)
  const fedTax = round2(fedIncomeTax + seTax)

  const stateTaxableIncome = Math.max(0, round2(w2Taxable + llcNet - VA_STD))
  const stateTax = round2(fromBrackets(stateTaxableIncome, VA_BR))
  const stateBrackets = bracketDetail(stateTaxableIncome, VA_BR)

  const refund = round2((fedW + stateW) - (fedTax + stateTax))

  const detail = {
    grossCombined: round2(annualGross + llcNet),
    w2Gross: annualGross, w2Pretax: annualPretax, w2Taxable,
    llcNet, halfSE,
    agi,
    fedStd: FED_STD, fedTaxableIncome, fedBrackets, fedIncomeTax, seTax, seBase,
    fedTotal: fedTax,
    vaStd: VA_STD, stateTaxableIncome, stateBrackets, stateTax,
    effectiveRate: agi > 0 ? Math.round((fedTax + stateTax) / agi * 1000) / 10 : 0,
  }
  return {
    asOf: p.entry_date || null,
    split: { ytd, roy, full },
    w2Taxable, w2Gross: annualGross, w2YTDGross: ytd.gross, llcNet, seTax, agi, method,
    fedWithheld: fedW, stateWithheld: stateW,
    fedLiability: fedTax, stateLiability: stateTax,
    totalWithheld: round2(fedW + stateW), totalLiability: round2(fedTax + stateTax),
    refund, owes: refund < 0, detail,
  }
}
