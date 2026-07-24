import { createClient } from '@supabase/supabase-js'

export const PLAID_ENV = process.env.PLAID_ENV || 'sandbox'
const BASE = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
}[PLAID_ENV] || 'https://sandbox.plaid.com'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

export const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

/** Call the Plaid REST API. Credentials are injected here and nowhere else. */
export async function plaid(path, body) {
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
export async function requireUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || ''
  const token = auth.replace(/^Bearer /i, '')
  if (!token) throw Object.assign(new Error('Not signed in'), { statusCode: 401 })
  const { data, error } = await admin().auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Invalid session'), { statusCode: 401 })
  return data.user
}

export function fail(err) {
  const status = err.statusCode || 500
  console.error('plaid function error:', err.message, JSON.stringify(err.plaid || {}))
  return {
    statusCode: status,
    headers: CORS,
    body: JSON.stringify({
      error: err.message,
      error_code: err.plaid?.error_code || null,
      error_type: err.plaid?.error_type || null,
      display_message: err.plaid?.display_message || null,
      env: process.env.PLAID_ENV || 'unset',
      has_client_id: !!process.env.PLAID_CLIENT_ID,
      has_secret: !!process.env.PLAID_SECRET,
    }),
  }
}

export const ok = (payload) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(payload) })

export function missingConfig() {
  const missing = ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
    .filter((k) => !process.env[k])
  return missing.length ? `Missing environment variables: ${missing.join(', ')}` : null
}

