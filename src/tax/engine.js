// ────────────────────────────────────────────────────────────
// Tax projection — "if this paycheck continues to year-end"
//
// Employment: annualise the current paycheck, compute true annual tax on
// the resulting income, and compare against projected withholding.
// LLC: single-member Schedule C. A loss reduces taxable income (offsets
// W-2). A profit would add SE tax + income tax, so both directions handled.
//
// This is an estimate, not tax advice: it uses 2025 brackets/standard
// deduction, single filer, Virginia, and ignores credits, itemising,
// other income, and QBI. Good enough to see the direction and rough size.
// ────────────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100

// 2025 federal, single
const FED_STD_2025 = 15000
const FED_BRACKETS_2025 = [
  [0, 0.10], [11925, 0.12], [48475, 0.22], [103350, 0.24],
  [197300, 0.32], [250525, 0.35], [626350, 0.37],
]
// Virginia
const VA_STD_2025 = 8500
const VA_BRACKETS_2025 = [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]]

function taxFromBrackets(taxable, brackets) {
  if (taxable <= 0) return 0
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i]
    const ceil = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity
    if (taxable > floor) tax += (Math.min(taxable, ceil) - floor) * rate
    else break
  }
  return tax
}

/**
 * @param p.periodsPerYear   e.g. 26
 * @param p.periodsElapsed   paychecks received so far this year
 * @param p.grossPerCheck    current gross
 * @param p.fedPerCheck      current federal withheld per check (incl. additional)
 * @param p.statePerCheck    current state withheld per check (incl. additional)
 * @param p.pretaxPerCheck   401k + Section 125 per check (reduces taxable wages)
 * @param p.llcNetIncome     projected annual Schedule C net (negative = loss)
 */
export function projectTax(p) {
  const periods = p.periodsPerYear || 26
  const gross = p.grossPerCheck || 0
  const pretax = p.pretaxPerCheck || 0

  // ---- employment: annualise the current paycheck ----
  const annualGross = round2(gross * periods)
  const annualPretax = round2(pretax * periods)
  const w2Taxable = Math.max(0, annualGross - annualPretax) // taxable wages (box 1-ish)
  const fedWithheld = round2((p.fedPerCheck || 0) * periods)
  const stateWithheld = round2((p.statePerCheck || 0) * periods)

  // ---- LLC: Schedule C ----
  const llcNet = p.llcNetIncome || 0
  // SE tax only on profit; a loss carries no SE tax
  const seTaxableBase = llcNet > 0 ? round2(llcNet * 0.9235) : 0
  const seTax = round2(seTaxableBase * 0.153)
  const halfSE = round2(seTax / 2) // above-the-line deduction

  // ---- combined taxable income ----
  // W-2 taxable wages + LLC net (loss reduces it) − half of SE tax
  const agi = round2(w2Taxable + llcNet - halfSE)
  const fedTaxable = Math.max(0, agi - FED_STD_2025)
  const fedIncomeTax = round2(taxFromBrackets(fedTaxable, FED_BRACKETS_2025))
  const fedTotal = round2(fedIncomeTax + seTax) // SE tax is federal

  // state: Virginia doesn't levy SE tax; uses federal-ish taxable base
  const stateTaxable = Math.max(0, w2Taxable + llcNet - VA_STD_2025)
  const stateTax = round2(taxFromBrackets(stateTaxable, VA_BRACKETS_2025))

  // ---- refund / owed = withheld − liability ----
  const fedRefund = round2(fedWithheld - fedTotal)
  const stateRefund = round2(stateWithheld - stateTax)
  const totalRefund = round2(fedRefund + stateRefund)

  return {
    annualGross, annualPretax, w2Taxable,
    llcNet, seTax, halfSE, agi,
    fed: { withheld: fedWithheld, incomeTax: fedIncomeTax, seTax, liability: fedTotal, refund: fedRefund, taxable: fedTaxable },
    state: { withheld: stateWithheld, liability: stateTax, refund: stateRefund, taxable: stateTaxable },
    totalWithheld: round2(fedWithheld + stateWithheld),
    totalLiability: round2(fedTotal + stateTax),
    totalRefund,
    owes: totalRefund < 0,
  }
}

export const DOC_TYPES = [
  { id: 'payslip', label: 'Payslip', cat: 'employment' },
  { id: 'w2', label: 'W-2', cat: 'employment', yearEnd: true },
  { id: '1095c', label: '1095-C', cat: 'employment', yearEnd: true },
  { id: 'receipt', label: 'Receipt', cat: 'llc' },
  { id: '1099', label: '1099', cat: 'llc', yearEnd: true },
  { id: 'other', label: 'Other', cat: 'llc' },
]
