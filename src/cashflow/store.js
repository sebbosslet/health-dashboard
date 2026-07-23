import { supabase } from '../lib/supabase'

/**
 * v1 persistence: the whole cashflow document lives in one jsonb row per user.
 * The app's shape is still moving, so this avoids schema churn while keeping
 * everything synced across devices. Plaid work will introduce proper
 * transaction tables alongside this.
 */
const TABLE = 'cashflow_state'

export async function loadCashflow(userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('doc')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('cashflow load failed', error)
    return null
  }
  return data?.doc ?? null
}

export async function saveCashflow(userId, doc) {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ user_id: userId, doc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) console.error('cashflow save failed', error)
}
