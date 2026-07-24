/**
 * Daily EUR→USD reference rate from the ECB, via Frankfurter.
 * No key, no account, published each working day around 16:00 CET.
 * This is the mid-market rate — the app adds your provider's spread on top.
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  const from = event.queryStringParameters?.from || 'EUR'
  const to = event.queryStringParameters?.to || 'USD'
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`)
    const json = await res.json()
    const rate = json?.rates?.[to]
    if (!rate) throw new Error('No rate returned')
    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({ from, to, rate, date: json.date, source: 'ECB via Frankfurter' }),
    }
  } catch (err) {
    console.error('fx-rate failed:', err.message)
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: err.message }) }
  }
}
