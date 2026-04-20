import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const EVENT_TYPES = [
  { type: 'flight',    emoji: '✈️',  label: 'Flights' },
  { type: 'train',     emoji: '🚂',  label: 'Trains' },
  { type: 'hotel',     emoji: '🏨',  label: 'Hotels' },
  { type: 'dinner',    emoji: '🍽',  label: 'Dining' },
  { type: 'activity',  emoji: '🎭',  label: 'Activities' },
  { type: 'social',    emoji: '🥂',  label: 'Social' },
  { type: 'transport', emoji: '🚗',  label: 'Transport' },
]

function fmt(n) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function CostTab({ trip, events, budgets, currency }) {
  const [overrides, setOverrides] = useState({})   // event_id → amount
  const [extras, setExtras] = useState([])          // [{id, label, amount}]
  const [loading, setLoading] = useState(true)
  const [editingExtra, setEditingExtra] = useState(null)
  const [newExtraLabel, setNewExtraLabel] = useState('')
  const [newExtraAmount, setNewExtraAmount] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchCosts() }, [trip.id])

  async function fetchCosts() {
    const { data } = await supabase.from('trip_costs')
      .select('*').eq('trip_id', trip.id)
    if (data) {
      const ov = {}
      const ex = []
      data.forEach(r => {
        if (r.event_id) ov[r.event_id] = r.amount
        else ex.push(r)
      })
      setOverrides(ov)
      setExtras(ex)
    }
    setLoading(false)
  }

  async function saveOverride(eventId, amount) {
    const val = amount === '' ? null : parseFloat(amount)
    setOverrides(prev => ({ ...prev, [eventId]: val }))
    if (val == null) {
      await supabase.from('trip_costs').delete().eq('trip_id', trip.id).eq('event_id', eventId)
    } else {
      await supabase.from('trip_costs').upsert({ trip_id: trip.id, event_id: eventId, amount: val, label: null }, { onConflict: 'trip_id,event_id' })
    }
  }

  async function addExtra() {
    if (!newExtraLabel.trim()) return
    setSaving(true)
    const val = newExtraAmount ? parseFloat(newExtraAmount) : null
    const { data } = await supabase.from('trip_costs').insert({
      trip_id: trip.id, event_id: null, label: newExtraLabel.trim(), amount: val
    }).select().single()
    if (data) setExtras(prev => [...prev, data])
    setNewExtraLabel('')
    setNewExtraAmount('')
    setSaving(false)
  }

  async function updateExtra(id, field, value) {
    setExtras(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    await supabase.from('trip_costs').update({ [field]: field === 'amount' ? (value ? parseFloat(value) : null) : value }).eq('id', id)
  }

  async function deleteExtra(id) {
    await supabase.from('trip_costs').delete().eq('id', id)
    setExtras(prev => prev.filter(e => e.id !== id))
  }

  // Group events by type, compute costs
  const billableEvents = events.filter(e => e.type !== 'note')
  const groupedByType = {}
  billableEvents.forEach(e => {
    if (!groupedByType[e.type]) groupedByType[e.type] = []
    groupedByType[e.type].push(e)
  })

  // Cost for each event: override → type budget ÷ count → null
  function costForEvent(ev) {
    if (overrides[ev.id] != null) return overrides[ev.id]
    const budget = budgets[ev.type]
    if (budget) {
      const count = groupedByType[ev.type]?.length || 1
      return budget / count
    }
    return null
  }

  // Totals
  const eventTotal = billableEvents.reduce((sum, ev) => sum + (costForEvent(ev) || 0), 0)
  const extraTotal = extras.reduce((sum, e) => sum + (e.amount || 0), 0)
  const grandTotal = eventTotal + extraTotal

  const sym = currency || '€'

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>

  return (
    <div style={{ padding: '0 0 40px' }}>

      {/* Grand total banner */}
      <div style={{ margin: '12px 16px', padding: '14px 16px', background: '#1c1c1e', borderRadius: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total trip cost</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'white', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{sym}{fmt(grandTotal)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#666' }}>Events</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#aaa' }}>{sym}{fmt(eventTotal)}</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Extras</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#aaa' }}>{sym}{fmt(extraTotal)}</div>
        </div>
      </div>

      {/* Events by type */}
      {EVENT_TYPES.filter(t => groupedByType[t.type]?.length).map(t => {
        const typeEvents = groupedByType[t.type] || []
        const typeBudget = budgets[t.type]
        const typeTotal = typeEvents.reduce((s, ev) => s + (costForEvent(ev) || 0), 0)
        return (
          <div key={t.type} style={{ margin: '0 16px 12px' }}>
            {/* Type header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15 }}>{t.emoji}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t.label}</span>
                {typeBudget && <span style={{ fontSize: 11, color: '#888', background: '#f5f5f7', padding: '1px 7px', borderRadius: 10 }}>{sym}{fmt(typeBudget)} budget</span>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1c1c1e' }}>{sym}{fmt(typeTotal)}</span>
            </div>

            {/* Event rows */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e5ea', overflow: 'hidden' }}>
              {typeEvents.map((ev, i) => {
                const cost = costForEvent(ev)
                const hasOverride = overrides[ev.id] != null
                return (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: i < typeEvents.length - 1 ? '0.5px solid #e5e5ea' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                      {ev.event_date && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{new Date(ev.event_date + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {hasOverride && <span style={{ fontSize: 10, color: '#888', background: '#f5f5f7', padding: '1px 5px', borderRadius: 6 }}>custom</span>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 13, color: '#888' }}>{sym}</span>
                        <input
                          type="number"
                          value={overrides[ev.id] != null ? overrides[ev.id] : (cost != null ? Math.round(cost) : '')}
                          placeholder={cost != null ? Math.round(cost) : '0'}
                          onChange={e => saveOverride(ev.id, e.target.value)}
                          style={{ width: 72, textAlign: 'right', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '5px 7px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: hasOverride ? '#f0fdf4' : '#f5f5f7', outline: 'none' }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Extra costs */}
      <div style={{ margin: '4px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15 }}>➕</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Extra costs</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{sym}{fmt(extraTotal)}</span>
        </div>

        {extras.length > 0 && (
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e5ea', overflow: 'hidden', marginBottom: 8 }}>
            {extras.map((ex, i) => (
              <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: i < extras.length - 1 ? '0.5px solid #e5e5ea' : 'none' }}>
                {editingExtra === ex.id ? (
                  <>
                    <input value={ex.label} onChange={e => updateExtra(ex.id, 'label', e.target.value)}
                      style={{ flex: 1, border: '1.5px solid #1c1c1e', borderRadius: 8, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit', background: 'white', outline: 'none' }} />
                    <span style={{ fontSize: 13, color: '#888' }}>{sym}</span>
                    <input type="number" value={ex.amount || ''} onChange={e => updateExtra(ex.id, 'amount', e.target.value)}
                      style={{ width: 72, textAlign: 'right', border: '1.5px solid #1c1c1e', borderRadius: 8, padding: '5px 7px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: 'white', outline: 'none' }} />
                    <button onClick={() => setEditingExtra(null)} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', padding: '0 2px', color: '#1c1c1e' }}>✓</button>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{ex.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{sym}{fmt(ex.amount)}</div>
                    <button onClick={() => setEditingExtra(ex.id)} style={{ background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', padding: '0 3px', color: '#888' }}>✏️</button>
                    <button onClick={() => deleteExtra(ex.id)} style={{ background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', padding: '0 3px', color: '#888' }}>🗑</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add extra */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px dashed #e5e5ea', padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={newExtraLabel} onChange={e => setNewExtraLabel(e.target.value)} placeholder="e.g. Travel insurance"
            style={{ flex: 1, border: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent', outline: 'none', color: '#1c1c1e' }}
            onKeyDown={e => e.key === 'Enter' && addExtra()} />
          <span style={{ fontSize: 13, color: '#888' }}>{sym}</span>
          <input type="number" value={newExtraAmount} onChange={e => setNewExtraAmount(e.target.value)} placeholder="0"
            style={{ width: 60, textAlign: 'right', border: 'none', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: 'transparent', outline: 'none' }}
            onKeyDown={e => e.key === 'Enter' && addExtra()} />
          <button onClick={addExtra} disabled={!newExtraLabel.trim() || saving}
            style={{ background: '#1c1c1e', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 600, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', opacity: !newExtraLabel.trim() ? 0.4 : 1 }}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
