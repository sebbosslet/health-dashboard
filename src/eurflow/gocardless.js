import { supabase } from '../lib/supabase'

async function call(fn, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body || {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const bits = [json.error || `${fn} failed (${res.status})`]
    if (json.detail) bits.push(json.detail)
    if (json.has_secret_id === false) bits.push('secret id missing')
    if (json.has_secret_key === false) bits.push('secret key missing')
    throw new Error(bits.join(' · '))
  }
  return json
}

export const listInstitutions = (country = 'DE') => call('gocardless-link', { list: true, country })
export const startLink = (institution_id) =>
  call('gocardless-link', { institution_id, redirect: `${window.location.origin}/eur` })
export const syncBanks = () => call('gocardless-sync', {})

export async function fetchGcAccounts(userId) {
  const { data, error } = await supabase.from('gocardless_accounts').select('*').eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function fetchGcTransactions(userId, limit = 15) {
  const { data, error } = await supabase.from('gocardless_transactions')
    .select('*').eq('user_id', userId).order('date', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}
