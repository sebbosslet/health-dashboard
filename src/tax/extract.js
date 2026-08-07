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
      "fed_withheld": number,                 // payslips only, else omit
      "state_withheld": number,               // payslips only, else omit
      "pretax": number,                       // payslips only: 401k+HSA+Section125, else omit
      "periods_per_year": number,             // payslips only: 26/24/12/52, else omit
      "confident": true                       // false if you are unsure of book/category
    }
  ]
}

Guidance:
- A payslip/pay stub -> book "w2", direction "income", category "Wages", amount = gross for the period, and fill the withholding fields.
- A W-2 form -> book "w2", income, category "Wages", amount = box 1 wages.
- A 1099 -> book "llc", income.
- A receipt/invoice for the business -> book "llc", expense; guess a sensible category.
- If you cannot tell whether an expense is business or personal, use book "llc" and confident:false.
- Most receipts are LLC expenses. Default book to "llc" when unsure.
- If you cannot read it, return {"doc_kind":"other","entries":[]}.`

export async function extractDocument(file) {
  const b64 = await toB64(file)
  const isPdf = file.type === 'application/pdf'
  const source = { type: 'base64', media_type: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'), data: b64 }
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
