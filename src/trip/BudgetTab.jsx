import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const EVENT_TYPES = [
  { type: 'flight',    emoji: '✈️',  label: 'Flights',     hint: 'Cost per flight leg' },
  { type: 'train',     emoji: '🚂',  label: 'Trains',      hint: 'Cost per train journey' },
  { type: 'hotel',     emoji: '🏨',  label: 'Hotels',      hint: 'Cost per hotel night' },
  { type: 'dinner',    emoji: '🍽',  label: 'Dining',      hint: 'Cost per meal/dining event' },
  { type: 'activity',  emoji: '🎭',  label: 'Activities',  hint: 'Cost per activity' },
  { type: 'social',    emoji: '🥂',  label: 'Social',      hint: 'Cost per social event' },
  { type: 'transport', emoji: '🚗',  label: 'Transport',   hint: 'Cost per transport leg' },
]

const CURRENCIES = ['€', '$', '£', '¥', 'CHF']

export default function BudgetTab({ trip, budgets, setBudgets, currency, setCurrency, onSave }) {
  const [local, setLocal] = useState({ ...budgets })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setLocal({ ...budgets }) }, [budgets])

  const total = Object.values(local).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  async function save() {
    setSaving(true)
    await supabase.from('trip_budgets').upsert(
      Object.entries(local).map(([type, amount]) => ({
        trip_id: trip.id, type, amount: parseFloat(amount) || 0,
      })),
      { onConflict: 'trip_id,type' }
    )
    await supabase.from('trips').update({ currency }).eq('id', trip.id)
    setBudgets(local)
    onSave?.()
    setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ padding: '12px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Currency */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e5e5ea', padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Currency</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {CURRENCIES.map(c => (
            <button key={c} onClick={() => setCurrency(c)} style={{
              flex: 1, padding: '8px 4px', borderRadius: 8, border: `1.5px solid ${currency === c ? '#1c1c1e' : '#e5e5ea'}`,
              background: currency === c ? '#1c1c1e' : 'white',
              color: currency === c ? 'white' : '#636366',
              fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>{c}</button>
          ))}
        </div>
      </div>

      {/* Budget per category */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e5e5ea', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 8px', borderBottom: '0.5px solid #e5e5ea' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cost per event by type</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 3 }}>Set the expected cost per event for each category — e.g. Hotel = €150 means each hotel night costs €150</div>
        </div>

        {EVENT_TYPES.map((t, i) => (
          <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < EVENT_TYPES.length - 1 ? '0.5px solid #e5e5ea' : 'none' }}>
            <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>{t.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>{t.hint}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 14, color: '#888', fontWeight: 600 }}>{currency}</span>
              <input
                type="number"
                value={local[t.type] || ''}
                placeholder="0"
                onChange={e => setLocal(prev => ({ ...prev, [t.type]: e.target.value }))}
                style={{ width: 80, textAlign: 'right', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '6px 8px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: '#f5f5f7', outline: 'none', color: '#1c1c1e' }}
              />
            </div>
          </div>
        ))}

        {/* Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f5f5f7', borderTop: '1px solid #e5e5ea' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Total forecast</span>
          <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{currency}{total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      <button onClick={save} disabled={saving} style={{
        width: '100%', padding: 14, borderRadius: 12, border: 'none', fontFamily: 'inherit',
        background: saved ? '#2d7a4f' : '#1c1c1e', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer',
      }}>
        {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save budget'}
      </button>
    </div>
  )
}
