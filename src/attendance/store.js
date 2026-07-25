import { supabase } from '../lib/supabase'

const TABLE = 'attendance_state'

export async function loadAttendance(userId) {
  const { data, error } = await supabase.from(TABLE).select('doc').eq('user_id', userId).maybeSingle()
  if (error) { console.error('attendance load failed', error); return null }
  return data?.doc ?? null
}

export async function saveAttendance(userId, doc) {
  const { error } = await supabase.from(TABLE)
    .upsert({ user_id: userId, doc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) console.error('attendance save failed', error)
}
