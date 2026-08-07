import { CLAUDE_MODEL } from '../lib/constants'

function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1])
    r.onerror = () => rej(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
}

const PROMPT = `You are a bookkeeping assistant reading ONE uploaded financial document
for a person who has both a W-2 job and a single-member LLC. Classify it and
extract ledger entries. Reply with ONLY JSON (no prose, no code fence):

{
  "doc_kind": "payslip|w2|1099|1095c|receipt|invoice|other",
  "entries": [
    {
      "entry_date": "YYYY-MM-DD",           // transaction / pay / document date
      "book": "llc|w2",                      // w2 = full-time job; llc = the business
      "direction": "income|expense",
      "category": "short category, e.g. Wages, Software, Meals, Contractor income, Office supplies",
      "vendor": "merchant or payer name, or ''",
      "amount": number,                       // positive, no $ or commas
      "note": "",
      "fed_withheld": number,                 // payslips only: THIS period's federal income tax
      "state_withheld": number,               // payslips only: THIS period's state income tax
      "pretax": number,                       // payslips only: THIS period's pre-tax (401k+HSA+Section125)
      "periods_per_year": number,             // payslips only: 26/24/12/52
      "ytd_gross": number,                    // payslips only: YEAR-TO-DATE gross from the YTD column
      "ytd_fed": number,                      // payslips only: YEAR-TO-DATE federal income tax withheld
      "ytd_state": number,                    // payslips only: YEAR-TO-DATE state income tax withheld
      "ytd_pretax": number,                   // payslips only: YEAR-TO-DATE pre-tax deductions (401k+HSA+Section125)
      "taxable_this": number,                 // payslips only: the explicitly stated "federal taxable wages this period" figure, if the stub prints it (else omit)
      "check_number": number,                 // payslips only: which paycheck this is in the year, if shown, else omit
      "confident": true                       // false if you are unsure of book/category
    }
  ]
}

Guidance for PAYSLIPS (very important — this drives a tax forecast):
- These payslips have TWO number columns: "this period" and "year to date". Read BOTH.
- book "w2", direction "income", category "Wages".
- amount = "Gross Pay" for THIS period (the this-period column).
- ytd_gross = "Gross Pay" in the YEAR TO DATE column (e.g. a large cumulative number).
- fed_withheld = "Federal Income Tax" this period; ytd_fed = its year-to-date value.
- state_withheld = the state income tax line this period (e.g. "VA State Income Tax"); ytd_state = its year-to-date value.
- pretax (this period) = SUM of the deduction lines marked as excluded from federal taxable wages — typically 401(k), Dental, Vision, Medical, Health Savings/HSA (often flagged with an asterisk *). Do NOT include 401K Loan (post-tax), taxes, or car/insurance items.
- ytd_pretax = SUM of the YEAR-TO-DATE column for those same pretax lines.
- taxable_this: MANY stubs print a line like "Your federal taxable wages this period are $X". If present, capture that exact number — it is authoritative and beats summing deduction lines.
- periods_per_year: biweekly pay period (~2 weeks between Period Beginning and Period Ending) = 26.
- check_number: if "Gross Pay YTD divided by this-period Gross Pay" is a whole number you may use it; otherwise omit and it will be inferred.
- entry_date = the Pay Date.
- ALWAYS fill ytd_gross/ytd_fed/ytd_state/ytd_pretax for a payslip. If a YTD value is genuinely absent, use 0, but the gross YTD is always present.
- A W-2 form -> book "w2", income, category "Wages", amount = box 1 wages.
- A 1099 -> book "llc", income.
- A receipt/invoice for the business -> book "llc", expense; guess a sensible category.
- If you cannot tell whether an expense is business or personal, use book "llc" and confident:false.
- Most receipts are LLC expenses. Default book to "llc" when unsure.
- If you cannot read it, return {"doc_kind":"other","entries":[]}.`

export async function extractDocument(file) {
  const b64 = await toB64(file)
  const name = (file.name || '').toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  // Some browsers report an empty or odd file.type; fall back by extension.
  let media = isPdf ? 'application/pdf'
    : file.type && file.type.startsWith('image/') ? file.type
    : name.endsWith('.png') ? 'image/png'
    : name.endsWith('.webp') ? 'image/webp'
    : name.endsWith('.heic') ? 'image/heic'
    : 'image/jpeg'
  if (!b64) throw new Error('could not read the file contents')
  const source = { type: 'base64', media_type: media, data: b64 }
  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 800,
      messages: [{ role: 'user', content: [{ type: isPdf ? 'document' : 'image', source }, { type: 'text', text: PROMPT }] }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || data.error || 'Extraction failed')
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  let parsed
  try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) }
  catch { throw new Error('Could not read that document') }
  return parsed
}
