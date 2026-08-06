import { supabase } from '../lib/supabase'

const TABLE = 'ostree_state'

export async function loadOstree(userId) {
  const { data, error } = await supabase.from(TABLE).select('doc').eq('user_id', userId).maybeSingle()
  if (error) { console.error('ostree load failed', error); return null }
  return data?.doc ?? null
}

export async function saveOstree(userId, doc) {
  const { error } = await supabase.from(TABLE)
    .upsert({ user_id: userId, doc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) console.error('ostree save failed', error)
}
