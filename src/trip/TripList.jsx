import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export default function TripList({ session, onSelectTrip }) {
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchTrips() }, [])

  async function fetchTrips() {
    const { data } = await supabase.from('trips')
      .select('*').eq('user_id', session.user.id).order('start_date', { ascending: true })
    setTrips(data || [])
    setLoading(false)
  }

  async function createTrip() {
    if (!name || !startDate || !endDate) return
    setSaving(true)
    const { data, error } = await supabase.from('trips').insert({
      user_id: session.user.id, name, start_date: startDate, end_date: endDate,
      created_at: new Date().toISOString()
    }).select().single()
    if (!error) { onSelectTrip(data) }
    setSaving(false)
  }

  async function deleteTrip(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this trip and all its events?')) return
    await supabase.from('trip_events').delete().eq('trip_id', id)
    await supabase.from('trips').delete().eq('id', id)
    fetchTrips()
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 0 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>✈️ My Trips</h1>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{session.user.email}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="trip-btn trip-btn-primary" onClick={() => setCreating(true)} style={{ fontSize: 13, padding: '8px 14px' }}>+ New trip</button>
          <button className="trip-btn trip-btn-secondary" onClick={() => supabase.auth.signOut()} style={{ fontSize: 13, padding: '8px 14px' }}>Sign out</button>
        </div>
      </div>

      {/* Create trip form */}
      {creating && (
        <div className="trip-card" style={{ padding: 20, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>New trip</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="trip-label">Trip name</label>
              <input className="trip-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Japan 2025" autoFocus />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="trip-label">Start date</label>
                <input className="trip-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="trip-label">End date</label>
                <input className="trip-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="trip-btn trip-btn-secondary" onClick={() => setCreating(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="trip-btn trip-btn-primary" onClick={createTrip} disabled={!name || !startDate || !endDate || saving} style={{ flex: 2 }}>
                {saving ? 'Creating...' : 'Create trip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trip list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="trip-spinner" style={{ margin: '0 auto' }} /></div>
      ) : trips.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text2)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No trips yet</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>Create your first trip to get started</div>
        </div>
      ) : trips.map(trip => (
        <div key={trip.id} className="trip-card" onClick={() => onSelectTrip(trip)}
          style={{ padding: '16px 18px', cursor: 'pointer', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{trip.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>
                {format(new Date(trip.start_date + 'T12:00'), 'd MMM')} – {format(new Date(trip.end_date + 'T12:00'), 'd MMM yyyy')}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 22 }}>→</div>
              <button onClick={e => deleteTrip(trip.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text3)', padding: '4px 6px' }}>🗑</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
