import { createClient } from '@supabase/supabase-js'

const BASE = 'https://bankaccountdata.gocardless.com/api/v2'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

export const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

let cachedToken = null   // { access, expiresAt }

/** GoCardless issues short-lived access tokens from a secret id/key pair. */
async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.access
  const res = await fetch(`${BASE}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
  })
  const json = await res.json()
  if (!res.ok) throw Object.assign(new Error(json.detail || 'GoCardless auth failed'), { statusCode: res.status, gc: json })
  cachedToken = { access: json.access, expiresAt: Date.now() + (json.access_expires || 3600) * 1000 }
  return cachedToken.access
}

export async function gc(path, { method = 'GET', body } = {}) {
  const token = await accessToken()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json.detail || json.summary || Object.values(json)[0]?.detail || `GoCardless ${path} failed`
    throw Object.assign(new Error(msg), { statusCode: res.status, gc: json })
  }
  return json
}

export async function requireUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || ''
  const token = auth.replace(/^Bearer /i, '')
  if (!token) throw Object.assign(new Error('Not signed in'), { statusCode: 401 })
  const { data, error } = await admin().auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Invalid session'), { statusCode: 401 })
  return data.user
}

export function missingConfig() {
  const missing = ['GOCARDLESS_SECRET_ID', 'GOCARDLESS_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
    .filter((k) => !process.env[k])
  return missing.length ? `Missing environment variables: ${missing.join(', ')}` : null
}

export function fail(err) {
  console.error('gocardless error:', err.message, JSON.stringify(err.gc || {}))
  return {
    statusCode: err.statusCode || 500,
    headers: CORS,
    body: JSON.stringify({
      error: err.message,
      detail: err.gc?.detail || null,
      has_secret_id: !!process.env.GOCARDLESS_SECRET_ID,
      has_secret_key: !!process.env.GOCARDLESS_SECRET_KEY,
    }),
  }
}

export const ok = (payload) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(payload) })
