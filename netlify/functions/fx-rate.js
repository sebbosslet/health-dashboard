/**
 * EUR→USD rate for planning.
 *
 * Revolut publishes no official consumer rate API. Their own site calls an
 * undocumented quote endpoint, which we try first and treat as best-effort:
 * if it moves, is blocked, or is slow, we fall back to the ECB daily
 * reference (Frankfurter) and let the app apply a spread instead.
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
])

async function ecbRate(from, to) {
  const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`)
  const json = await res.json()
  const rate = json?.rates?.[to]
  if (!rate) throw new Error('ECB: no rate')
  return { rate, date: json.date, source: 'ECB reference' }
}

async function revolutRate(from, to, amount = 1000) {
  const url = `https://www.revolut.com/api/quote/public?amount=${amount * 100}`
    + `&country=DE&fromCurrency=${from}&isRecipientAmount=false&toCurrency=${to}`
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'sebs.cashflow' } })
  if (!res.ok) throw new Error(`Revolut: HTTP ${res.status}`)
  const j = await res.json()
  const rate = Number(j?.rate?.rate ?? j?.rate)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Revolut: no rate in response')
  const feeMinor = Number(j?.fees?.[0]?.amount ?? j?.fee ?? 0)
  return {
    rate,
    date: new Date().toISOString().slice(0, 10),
    source: 'Revolut quote',
    fee: feeMinor ? feeMinor / 100 : 0,
    quotedOn: amount,
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  const from = event.queryStringParameters?.from || 'EUR'
  const to = event.queryStringParameters?.to || 'USD'
  const amount = Number(event.queryStringParameters?.amount) || 1000

  let reference = null
  try { reference = await withTimeout(ecbRate(from, to), 4000) } catch (e) { console.error('ecb failed', e.message) }

  let live = null
  try { live = await withTimeout(revolutRate(from, to, amount), 4000) } catch (e) { console.error('revolut failed', e.message) }

  const chosen = live || reference
  if (!chosen) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'No rate source available' }) }
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Cache-Control': 'public, max-age=1800' },
    body: JSON.stringify({
      from, to,
      rate: chosen.rate,
      date: chosen.date,
      source: chosen.source,
      fee: chosen.fee ?? 0,
      reference: reference?.rate ?? null,
      referenceDate: reference?.date ?? null,
      // how far the provider quote sits from mid-market, as a percentage
      spreadPct: live && reference ? Math.round(((reference.rate / live.rate) - 1) * 10000) / 100 : null,
    }),
  }
}
