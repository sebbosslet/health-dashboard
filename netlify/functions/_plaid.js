const { createClient } = require('@supabase/supabase-js')

const PLAID_ENV = process.env.PLAID_ENV || 'sandbox'
const BASE = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
}[PLAID_ENV] || 'https://sandbox.plaid.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

/** Call the Plaid REST API. Credentials are injected here and nowhere else. */
async function plaid(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  })
  const json = await res.json()
  if (!res.ok) {
    const err = new Error(json.error_message || `Plaid ${path} failed`)
    err.plaid = json
    err.statusCode = res.status
    throw err
  }
  return json
}

/** Resolve the caller from their Supabase JWT — never trust a user_id in the body. */
async function requireUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || ''
  const token = auth.replace(/^Bearer /i, '')
  if (!token) throw Object.assign(new Error('Not signed in'), { statusCode: 401 })
  const { data, error } = await admin().auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Invalid session'), { statusCode: 401 })
  return data.user
}

function fail(err) {
  const status = err.statusCode || 500
  console.error('plaid function error:', err.message, err.plaid || '')
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: err.message }) }
}

const ok = (payload) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(payload) })

function missingConfig() {
  const missing = ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
    .filter((k) => !process.env[k])
  return missing.length ? `Missing environment variables: ${missing.join(', ')}` : null
}

module.exports = { plaid, admin, requireUser, fail, ok, CORS, PLAID_ENV, missingConfig }
