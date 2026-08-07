import { supabase } from '../lib/supabase'

export async function loadTaxState(userId) {
  const { data, error } = await supabase.from('tax_state').select('doc').eq('user_id', userId).maybeSingle()
  if (error) { console.error('tax state load failed', error); return null }
  return data?.doc ?? null
}

export async function saveTaxState(userId, doc) {
  const { error } = await supabase.from('tax_state')
    .upsert({ user_id: userId, doc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) console.error('tax state save failed', error)
}

const BUCKET = 'tax-documents'

export async function uploadTaxDoc(userId, file, meta) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${userId}/${meta.tax_year}/${Date.now()}-${safe}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw up.error
  const { error } = await supabase.from('tax_documents').insert({
    user_id: userId, storage_path: path, file_name: file.name, mime_type: file.type,
    size_bytes: file.size, category: meta.category, doc_type: meta.doc_type,
    year_end: !!meta.year_end, tax_year: meta.tax_year, note: meta.note || null,
  })
  if (error) throw error
}

export async function listTaxDocs(userId, taxYear) {
  let q = supabase.from('tax_documents').select('*').order('uploaded_at', { ascending: false })
  if (userId) q = q.eq('user_id', userId)
  if (taxYear) q = q.eq('tax_year', taxYear)
  const { data, error } = await q
  if (error) { console.error('tax docs list failed', error); return [] }
  return data || []
}

export async function signedUrl(path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || null
}

export async function deleteTaxDoc(doc) {
  await supabase.storage.from(BUCKET).remove([doc.storage_path])
  const { error } = await supabase.from('tax_documents').delete().eq('id', doc.id)
  if (error) throw error
}
