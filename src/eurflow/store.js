import { supabase } from '../lib/supabase'

const TABLE = 'eurflow_state'

export async function loadEurflow(userId) {
  const { data, error } = await supabase.from(TABLE).select('doc').eq('user_id', userId).maybeSingle()
  if (error) { console.error('eurflow load failed', error); return null }
  return data?.doc ?? null
}

export async function saveEurflow(userId, doc) {
  const { error } = await supabase.from(TABLE)
    .upsert({ user_id: userId, doc, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) console.error('eurflow save failed', error)
}

export function seedEurflow(today) {
  return {
    anchor: { date: today, balance: 420 },
    funding: { minBalance: 300, fundingDay: 5, roundTo: 50, fxRate: 1.08 },
    rules: [
      { id: 'r1', name: 'Miete Stellplatz', amount: 95, dueDay: 1, active: true, startDate: '2025-01-01', endDate: '' },
      { id: 'r2', name: 'Krankenversicherung', amount: 210, dueDay: 3, active: true, startDate: '2025-01-01', endDate: '' },
      { id: 'r3', name: 'Handyvertrag', amount: 29.99, dueDay: 10, active: true, startDate: '2025-01-01', endDate: '' },
      { id: 'r4', name: 'Strom', amount: 48, dueDay: 15, active: true, startDate: '2025-01-01', endDate: '' },
      { id: 'r5', name: 'Sparplan', amount: 100, dueDay: 20, active: true, startDate: '2025-01-01', endDate: '' },
    ],
    transactions: [],
    observations: [],
  }
}
