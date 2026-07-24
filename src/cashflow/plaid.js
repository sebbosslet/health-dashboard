import { supabase } from '../lib/supabase'

const LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

/** Load Plaid Link once, on demand. */
export function loadPlaidScript() {
  if (window.Plaid) return Promise.resolve(window.Plaid)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${LINK_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Plaid))
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.src = LINK_SRC
    s.onload = () => resolve(window.Plaid)
    s.onerror = () => reject(new Error('Could not load Plaid Link'))
    document.head.appendChild(s)
  })
}

async function call(fn, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify(body || {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `${fn} failed (${res.status})`)
  return json
}

export const createLinkToken = (access_token) => call('plaid-link-token', { access_token })
export const exchangePublicToken = (public_token, institution) =>
  call('plaid-exchange', { public_token, institution })
export const syncNow = () => call('plaid-sync', {})

/** Open Plaid Link and resolve once the connection is stored. */
export async function connectBank({ reauthToken } = {}) {
  const Plaid = await loadPlaidScript()
  const { link_token } = await createLinkToken(reauthToken)
  return new Promise((resolve, reject) => {
    const handler = Plaid.create({
      token: link_token,
      onSuccess: async (public_token, metadata) => {
        try { resolve(await exchangePublicToken(public_token, metadata.institution)) }
        catch (e) { reject(e) }
      },
      onExit: (err) => {
        if (err) reject(new Error(err.display_message || err.error_message || 'Connection cancelled'))
        else resolve(null)
      },
    })
    handler.open()
  })
}

export async function fetchPlaidAccounts(userId) {
  const { data, error } = await supabase
    .from('plaid_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('type', { ascending: true })
  if (error) throw error
  return data || []
}

export async function saveMapping(accountId, mapping_kind, mapping_ref) {
  const { error } = await supabase
    .from('plaid_accounts')
    .update({ mapping_kind, mapping_ref })
    .eq('account_id', accountId)
  if (error) throw error
}

export async function recentTransactions(userId, limit = 25) {
  const { data, error } = await supabase
    .from('plaid_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}
