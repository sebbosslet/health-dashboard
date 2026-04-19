import { useState } from 'react'
import { format } from 'date-fns'

const EVENT_TYPES = [
  { type: 'flight',    emoji: '✈️',  label: 'Flight' },
  { type: 'train',     emoji: '🚂',  label: 'Train' },
  { type: 'hotel',     emoji: '🏨',  label: 'Hotel' },
  { type: 'dinner',    emoji: '🍽',  label: 'Dinner/Food' },
  { type: 'activity',  emoji: '🎭',  label: 'Activity' },
  { type: 'social',    emoji: '🥂',  label: 'Social event' },
  { type: 'transport', emoji: '🚗',  label: 'Transport' },
  { type: 'note',      emoji: '📝',  label: 'Note' },
]

// Placeholder hints per type
const PLACEHOLDERS = {
  flight:    { title: 'e.g. BA456 London → Tokyo', location: 'Heathrow T5', details: 'Seat 22A, window. Check-in online by 10pm.', confirmation: 'ABC123' },
  train:     { title: 'e.g. Eurostar London → Paris', location: 'St Pancras', details: 'Coach 4, seats 45-46', confirmation: 'TKT789' },
  hotel:     { title: 'e.g. Park Hyatt Tokyo', location: 'Shinjuku, Tokyo', details: 'Check-in 3pm. Late checkout requested.', confirmation: 'HTL456' },
  dinner:    { title: 'e.g. Nobu Tokyo', location: 'Roppongi', details: 'Reservation for 4. Ask for window table.', confirmation: '' },
  activity:  { title: 'e.g. TeamLab Planets', location: 'Toyosu, Tokyo', details: 'Pre-booked tickets. Wear socks.', confirmation: '' },
  social:    { title: 'e.g. Drinks with Kenji', location: 'Bar High Five, Ginza', details: '', confirmation: '' },
  transport: { title: 'e.g. Airport transfer', location: 'Narita → Shinjuku', details: 'N\'EX train, IC card works', confirmation: '' },
  note:      { title: 'e.g. Pack light jacket', location: '', details: '', confirmation: '' },
}

export default function EventForm({ trip, event, defaultDate, onSave, onCancel, days }) {
  const [type, setType] = useState(event?.type || 'flight')
  const [title, setTitle] = useState(event?.title || '')
  const [date, setDate] = useState(event?.event_date || defaultDate)
  const [startTime, setStartTime] = useState(event?.start_time?.slice(0,5) || '')
  const [endTime, setEndTime] = useState(event?.end_time?.slice(0,5) || '')
  const [location, setLocation] = useState(event?.location || '')
  const [details, setDetails] = useState(event?.details || '')
  const [confirmation, setConfirmation] = useState(event?.confirmation || '')
  const [saving, setSaving] = useState(false)

  const ph = PLACEHOLDERS[type] || PLACEHOLDERS.note

  async function save() {
    if (!title || !date) return
    setSaving(true)
    await onSave({
      type, title: title.trim(), event_date: date,
      start_time: startTime || null, end_time: endTime || null,
      location: location.trim() || null, details: details.trim() || null,
      confirmation: confirmation.trim() || null,
    })
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={{ width: '100%', maxWidth: 480, background: 'white', borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{event ? 'Edit event' : 'Add event'}</div>

        {/* Type selector */}
        <div style={{ marginBottom: 16 }}>
          <label className="trip-label">Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {EVENT_TYPES.map(t => (
              <button key={t.type} onClick={() => setType(t.type)} style={{
                padding: '8px 4px', borderRadius: 10, border: `1.5px solid ${type === t.type ? '#1c1c1e' : 'var(--border)'}`,
                background: type === t.type ? '#1c1c1e' : 'white',
                color: type === t.type ? 'white' : 'var(--text2)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}>
                <span style={{ fontSize: 18 }}>{t.emoji}</span>
                {t.label.split('/')[0]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Title */}
          <div>
            <label className="trip-label">Title *</label>
            <input className="trip-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={ph.title} autoFocus />
          </div>

          {/* Date */}
          <div>
            <label className="trip-label">Date *</label>
            <select className="trip-input" value={date} onChange={e => setDate(e.target.value)}>
              {days.map(d => {
                const key = format(d, 'yyyy-MM-dd')
                return <option key={key} value={key}>{format(d, 'EEEE, d MMMM')}</option>
              })}
            </select>
          </div>

          {/* Times */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="trip-label">Start time</label>
              <input className="trip-input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div>
              <label className="trip-label">End time</label>
              <input className="trip-input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="trip-label">Location / From → To</label>
            <input className="trip-input" value={location} onChange={e => setLocation(e.target.value)} placeholder={ph.location} />
          </div>

          {/* Details */}
          <div>
            <label className="trip-label">Details / Notes</label>
            <textarea className="trip-input" value={details} onChange={e => setDetails(e.target.value)} placeholder={ph.details} rows={3} />
          </div>

          {/* Confirmation */}
          {['flight','train','hotel'].includes(type) && (
            <div>
              <label className="trip-label">Confirmation / Booking ref</label>
              <input className="trip-input" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder={ph.confirmation} />
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
            <button className="trip-btn trip-btn-secondary" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
            <button className="trip-btn trip-btn-primary" onClick={save} disabled={!title || !date || saving} style={{ flex: 2 }}>
              {saving ? 'Saving...' : event ? 'Save changes' : 'Add to itinerary'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
