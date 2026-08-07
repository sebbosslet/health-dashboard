import { supabase } from '../lib/supabase'

const BUCKET = 'tax-documents'

export async function loadTaxState(userId) {
  const { data, error } = await supabase.from('tax_state').select('doc').eq('user_id', userId).maybeSingle()
  if (error) { console.error(error); return null }
  return data?.doc ?? null
}
export async function saveTaxState(userId, doc) {
  const { error } = await supabase.from('tax_state')
    .upsert({ user_id: userId, doc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) console.error(error)
}

export async function uploadFile(userId, file, docKind, taxYear) {
  const safe = (file.name || 'document.pdf').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-120)
  const path = `${userId}/${taxYear}/${Date.now()}-${safe || 'file'}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw up.error
  const { data, error } = await supabase.from('tax_documents').insert({
    user_id: userId, storage_path: path, file_name: file.name, mime_type: file.type,
    size_bytes: file.size, doc_kind: docKind, tax_year: taxYear,
  }).select().single()
  if (error) throw error
  return data
}

export async function addEntry(userId, entry) {
  const { data, error } = await supabase.from('tax_entries')
    .insert({ user_id: userId, ...entry }).select().single()
  if (error) throw error
  return data
}
export async function updateEntry(id, patch) {
  const { error } = await supabase.from('tax_entries').update(patch).eq('id', id)
  if (error) throw error
}
export async function deleteEntry(id) {
  const { error } = await supabase.from('tax_entries').delete().eq('id', id)
  if (error) throw error
}
export async function listEntries(userId, taxYear) {
  let q = supabase.from('tax_entries').select('*').eq('tax_year', taxYear).order('entry_date', { ascending: true })
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q
  if (error) { console.error(error); return [] }
  return data || []
}

export async function signedUrl(path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || null
}
