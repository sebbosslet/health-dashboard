import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format, parseISO, addDays, differenceInDays } from 'date-fns'

const EVENT_TYPES = [
  { type: 'flight',    emoji: '✈️' },
  { type: 'train',     emoji: '🚂' },
  { type: 'hotel',     emoji: '🏨' },
  { type: 'dinner',    emoji: '🍽' },
  { type: 'activity',  emoji: '🎭' },
  { type: 'social',    emoji: '🥂' },
  { type: 'transport', emoji: '🚗' },
  { type: 'note',      emoji: '📝' },
]
function getEmoji(type) { return EVENT_TYPES.find(t => t.type === type)?.emoji || '📌' }

function getDays(trip) {
  const days = []
  const n = differenceInDays(parseISO(trip.end_date), parseISO(trip.start_date)) + 1
  for (let i = 0; i < n; i++) days.push(addDays(parseISO(trip.start_date), i))
  return days
}

function fmt(n) {
  if (n == null || n === '' || n === 0) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function CostTab({ trip, events, budgets, currency }) {
  const [overrides, setOverrides] = useState({})
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const [newExtra, setNewExtra] = useState({ date: trip.start_date, label: '', amount: '' })
  const [saving, setSaving] = useState(false)
  const sym = currency || '€'
  const days = getDays(trip)

  useEffect(() => { fetchCosts() }, [trip.id])

  async function fetchCosts() {
    const { data } = await supabase.from('trip_costs').select('*').eq('trip_id', trip.id)
    if (data) {
      const ov = {}
      const ex = []
      data.forEach(r => { if (r.event_id) ov[r.event_id] = r.amount; else ex.push(r) })
      setOverrides(ov)
      setExtras(ex)
    }
    setLoading(false)
  }

  async function saveOverride(eventId, value) {
    const val = value === '' ? null : parseFloat(value)
    setOverrides(prev => ({ ...prev, [eventId]: val === null ? undefined : val }))
    if (val == null) {
      await supabase.from('trip_costs').delete().eq('trip_id', trip.id).eq('event_id', eventId)
    } else {
      await supabase.from('trip_costs').upsert({ trip_id: trip.id, event_id: eventId, amount: val, label: null }, { onConflict: 'trip_id,event_id' })
    }
  }

  async function addExtra() {
    if (!newExtra.label.trim()) return
    setSaving(true)
    const { data } = await supabase.from('trip_costs').insert({
      trip_id: trip.id, event_id: null,
      label: newExtra.label.trim(),
      amount: newExtra.amount ? parseFloat(newExtra.amount) : null,
      event_date: newExtra.date,
    }).select().single()
    if (data) setExtras(prev => [...prev, data])
    setNewExtra({ date: trip.start_date, label: '', amount: '' })
    setSaving(false)
  }

  async function deleteExtra(id) {
    await supabase.from('trip_costs').delete().eq('id', id)
    setExtras(prev => prev.filter(e => e.id !== id))
  }

  async function updateExtra(id, field, value) {
    setExtras(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    const update = { [field]: field === 'amount' ? (value ? parseFloat(value) : null) : value }
    await supabase.from('trip_costs').update(update).eq('id', id)
  }

  function costForEvent(ev) {
    if (overrides[ev.id] != null) return overrides[ev.id]
    return budgets[ev.type] ?? null
  }

  // Build per-day data
  const billableEvents = events.filter(e => e.type !== 'note')

  function eventsForDay(date) {
    const d = format(date, 'yyyy-MM-dd')
    return billableEvents.filter(e => e.event_date === d).sort((a, b) => {
      if (!a.start_time) return 1; if (!b.start_time) return -1
      return a.start_time.localeCompare(b.start_time)
    })
  }
  function extrasForDay(date) {
    const d = format(date, 'yyyy-MM-dd')
    return extras.filter(e => e.event_date === d)
  }

  const activeDays = days.filter(d => eventsForDay(d).length > 0 || extrasForDay(d).length > 0)

  const allEventCosts = billableEvents.reduce((s, ev) => s + (costForEvent(ev) || 0), 0)
  const allExtraCosts = extras.reduce((s, e) => s + (e.amount || 0), 0)
  const grandTotal = allEventCosts + allExtraCosts

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* Grand total */}
      <div style={{ margin: '12px 16px 8px', padding: '14px 18px', background: '#1c1c1e', borderRadius: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total trip</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: 'white', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>{sym}{grandTotal > 0 ? grandTotal.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, color: '#888' }}>{activeDays.length} days with spend</div>
          {grandTotal > 0 && activeDays.length > 0 && (
            <div style={{ fontSize: 12, color: '#aaa' }}>avg {sym}{Math.round(grandTotal / activeDays.length)}/day</div>
          )}
        </div>
      </div>

      {/* Days */}
      {days.map(day => {
        const key = format(day, 'yyyy-MM-dd')
        const dayEvents = eventsForDay(day)
        const dayExtras = extrasForDay(day)
        if (dayEvents.length === 0 && dayExtras.length === 0) return null

        const dayEventTotal = dayEvents.reduce((s, ev) => s + (costForEvent(ev) || 0), 0)
        const dayExtraTotal = dayExtras.reduce((s, e) => s + (e.amount || 0), 0)
        const dayTotal = dayEventTotal + dayExtraTotal

        return (
          <div key={key} style={{ margin: '0 16px 14px' }}>
            {/* Day header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 6px' }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{format(day, 'EEEE d')}</span>
                <span style={{ fontSize: 12, color: '#888', marginLeft: 6 }}>{format(day, 'MMMM')}</span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {dayTotal > 0 ? `${sym}${dayTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
              </span>
            </div>

            {/* Event + extra rows */}
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e5ea', overflow: 'hidden' }}>
              {dayEvents.map((ev, i) => {
                const cost = costForEvent(ev)
                const hasOverride = overrides[ev.id] != null
                return (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: (i < dayEvents.length - 1 || dayExtras.length > 0) ? '0.5px solid #e5e5ea' : 'none' }}>
                    <span style={{ fontSize: 17, flexShrink: 0 }}>{getEmoji(ev.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                      {ev.start_time && <div style={{ fontSize: 11, color: '#aaa' }}>{ev.start_time.slice(0,5)}{ev.end_time ? ` – ${ev.end_time.slice(0,5)}` : ''}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {hasOverride && <span style={{ fontSize: 9, color: '#aaa', background: '#f5f5f7', padding: '1px 4px', borderRadius: 4 }}>custom</span>}
                      <span style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}>{sym}</span>
                      <input
                        type="number"
                        value={hasOverride ? overrides[ev.id] : (cost != null ? cost : '')}
                        placeholder={cost != null ? cost : '—'}
                        onChange={e => saveOverride(ev.id, e.target.value)}
                        style={{
                          width: 68, textAlign: 'right', border: `1.5px solid ${hasOverride ? '#2d7a4f' : '#e5e5ea'}`,
                          borderRadius: 8, padding: '5px 7px', fontSize: 13, fontWeight: 700,
                          fontFamily: 'inherit', background: hasOverride ? '#f0fdf4' : '#f5f5f7',
                          outline: 'none', color: '#1c1c1e',
                        }}
                      />
                    </div>
                  </div>
                )
              })}

              {/* Extras for this day */}
              {dayExtras.map((ex, i) => (
                <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: i < dayExtras.length - 1 ? '0.5px solid #e5e5ea' : 'none', background: '#fafafa' }}>
                  <span style={{ fontSize: 17, flexShrink: 0 }}>➕</span>
                  <input value={ex.label} onChange={e => updateExtra(ex.id, 'label', e.target.value)}
                    style={{ flex: 1, border: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent', outline: 'none', color: '#1c1c1e', fontWeight: 600 }} />
                  <span style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}>{sym}</span>
                  <input type="number" value={ex.amount || ''} onChange={e => updateExtra(ex.id, 'amount', e.target.value)}
                    style={{ width: 68, textAlign: 'right', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '5px 7px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: '#f5f5f7', outline: 'none' }} />
                  <button onClick={() => deleteExtra(ex.id)} style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', color: '#ccc', padding: '0 2px', flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Add extra cost */}
      <div style={{ margin: '4px 16px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Add extra cost</div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px dashed #e5e5ea', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Date</div>
              <select value={newExtra.date} onChange={e => setNewExtra(p => ({ ...p, date: e.target.value }))}
                style={{ width: '100%', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '7px 8px', fontSize: 12, fontFamily: 'inherit', background: '#f5f5f7', outline: 'none', color: '#1c1c1e' }}>
                {days.map(d => { const k = format(d, 'yyyy-MM-dd'); return <option key={k} value={k}>{format(d, 'EEE d MMM')}</option> })}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={newExtra.label} onChange={e => setNewExtra(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Travel insurance"
              style={{ flex: 1, border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: '#f5f5f7', outline: 'none', color: '#1c1c1e' }}
              onKeyDown={e => e.key === 'Enter' && addExtra()} />
            <span style={{ fontSize: 13, color: '#888', fontWeight: 600 }}>{sym}</span>
            <input type="number" value={newExtra.amount} onChange={e => setNewExtra(p => ({ ...p, amount: e.target.value }))} placeholder="0"
              style={{ width: 68, textAlign: 'right', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '7px 8px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: '#f5f5f7', outline: 'none' }}
              onKeyDown={e => e.key === 'Enter' && addExtra()} />
            <button onClick={addExtra} disabled={!newExtra.label.trim() || saving}
              style={{ background: '#1c1c1e', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 600, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', opacity: !newExtra.label.trim() ? 0.4 : 1, flexShrink: 0 }}>
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
