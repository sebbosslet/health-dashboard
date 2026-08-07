// Extract paycheck figures from an uploaded payslip using Claude vision,
import { CLAUDE_MODEL } from '../lib/constants'
// via the existing claude-proxy function. Returns numbers to pre-fill the
// form — the user always confirms before they're used.

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(new Error('Could not read the file'))
    r.readAsDataURL(file)
  })
}

const PROMPT = `You are reading a single US payslip / pay stub. Extract these
per-paycheck figures and reply with ONLY a JSON object, no prose, no code fence:

{
  "grossPerCheck": number,      // gross pay for THIS pay period
  "fedPerCheck": number,        // federal income tax withheld this period (include any additional federal withholding)
  "statePerCheck": number,      // state income tax withheld this period (include any additional state withholding)
  "pretaxPerCheck": number,     // sum of pre-tax deductions this period that reduce taxable wages: 401(k), HSA, and Section 125 (medical/dental/vision/FSA). Do NOT include Roth or after-tax items.
  "periodsPerYear": number,     // 26 if biweekly, 24 if semi-monthly, 12 if monthly, 52 if weekly. Infer from pay period dates if shown, else 26.
  "payDate": string             // the pay date in YYYY-MM-DD if visible, else ""
}

Rules: numbers only (no $ or commas). If a value isn't present, use 0.
If you are not confident this is a payslip, reply {"error":"not a payslip"}.`

export async function extractPayslip(file) {
  const b64 = await fileToBase64(file)
  const isPdf = file.type === 'application/pdf'
  const source = isPdf
    ? { type: 'base64', media_type: 'application/pdf', data: b64 }
    : { type: 'base64', media_type: file.type || 'image/jpeg', data: b64 }

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: isPdf ? 'document' : 'image', source },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || data.error || 'Extraction failed')

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
  let parsed
  try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) }
  catch { throw new Error('Could not read the figures from that file') }
  if (parsed.error) throw new Error(parsed.error === 'not a payslip' ? "That doesn't look like a payslip" : parsed.error)
  return parsed
}
