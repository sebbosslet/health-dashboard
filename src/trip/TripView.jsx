import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { format, addDays, differenceInDays, parseISO } from 'date-fns'
import EventForm from './EventForm'

const EVENT_TYPES = [
  { type: 'flight',   emoji: '✈️',  label: 'Flight',        color: '#0071e3', bg: '#e8f0fb' },
  { type: 'train',    emoji: '🚂',  label: 'Train',         color: '#7c3aed', bg: '#ede9fe' },
  { type: 'hotel',    emoji: '🏨',  label: 'Hotel',         color: '#059669', bg: '#d1fae5' },
  { type: 'dinner',   emoji: '🍽',  label: 'Dinner/Food',   color: '#d97706', bg: '#fef3c7' },
  { type: 'activity', emoji: '🎭',  label: 'Activity',      color: '#dc2626', bg: '#fee2e2' },
  { type: 'social',   emoji: '🥂',  label: 'Social event',  color: '#db2777', bg: '#fce7f3' },
  { type: 'transport',emoji: '🚗',  label: 'Transport',     color: '#64748b', bg: '#f1f5f9' },
  { type: 'note',     emoji: '📝',  label: 'Note',          color: '#92400e', bg: '#fef3c7' },
]

function getType(t) { return EVENT_TYPES.find(e => e.type === t) || EVENT_TYPES[EVENT_TYPES.length - 1] }

function getDays(trip) {
  const days = []
  const n = differenceInDays(parseISO(trip.end_date), parseISO(trip.start_date)) + 1
  for (let i = 0; i < n; i++) days.push(addDays(parseISO(trip.start_date), i))
  return days
}

export default function TripView({ trip, session, onBack }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editEvent, setEditEvent] = useState(null)
  const [defaultDate, setDefaultDate] = useState(trip.start_date)
  const days = getDays(trip)
  const dayRefs = useRef({})

  useEffect(() => { fetchEvents() }, [trip.id])

  async function fetchEvents() {
    const { data } = await supabase.from('trip_events')
      .select('*').eq('trip_id', trip.id).order('event_date').order('start_time')
    setEvents(data || [])
    setLoading(false)
  }

  function eventsForDay(date) {
    const d = format(date, 'yyyy-MM-dd')
    return events.filter(e => e.event_date === d).sort((a, b) => {
      if (!a.start_time) return 1
      if (!b.start_time) return -1
      return a.start_time.localeCompare(b.start_time)
    })
  }

  function scrollToDay(date) {
    const key = format(date, 'yyyy-MM-dd')
    dayRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function deleteEvent(id) {
    await supabase.from('trip_events').delete().eq('id', id)
    setEvents(prev => prev.filter(e => e.id !== id))
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'white', borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: '0 4px', color: 'var(--text2)' }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{trip.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              {format(parseISO(trip.start_date), 'd MMM')} – {format(parseISO(trip.end_date), 'd MMM yyyy')} · {days.length} days
            </div>
          </div>
          <button className="trip-btn trip-btn-primary" onClick={() => { setEditEvent(null); setDefaultDate(trip.start_date); setShowForm(true) }}
            style={{ fontSize: 13, padding: '7px 14px' }}>+ Add</button>
        </div>

        {/* Day tabs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd')
            const count = eventsForDay(day).length
            const isToday = key === format(new Date(), 'yyyy-MM-dd')
            return (
              <button key={key} onClick={() => scrollToDay(day)} style={{
                flexShrink: 0, padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: isToday ? '#1c1c1e' : 'var(--surface2)',
                color: isToday ? 'white' : 'var(--text2)',
                fontSize: 12, fontWeight: 600,
              }}>
                {format(day, 'EEE d')}
                {count > 0 && <span style={{ marginLeft: 4, background: isToday ? 'rgba(255,255,255,0.3)' : 'var(--border)', borderRadius: 10, padding: '0 5px', fontSize: 10 }}>{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Days */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="trip-spinner" style={{ margin: '0 auto' }} /></div>
      ) : (
        <div style={{ paddingTop: 8 }}>
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd')
            const dayEvents = eventsForDay(day)
            const isToday = key === format(new Date(), 'yyyy-MM-dd')
            return (
              <div key={key} ref={el => dayRefs.current[key] = el} style={{ marginBottom: 4 }}>
                {/* Day header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isToday ? '#1c1c1e' : 'var(--surface2)',
                      color: isToday ? 'white' : 'var(--text)',
                      fontWeight: 700, fontSize: 14,
                    }}>{format(day, 'd')}</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{format(day, 'EEEE')}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{format(day, 'd MMMM yyyy')}</div>
                    </div>
                  </div>
                  <button onClick={() => { setEditEvent(null); setDefaultDate(key); setShowForm(true) }}
                    style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit' }}>
                    + Add
                  </button>
                </div>

                {/* Events */}
                {dayEvents.length === 0 ? (
                  <div style={{ margin: '0 16px 8px', padding: '16px', background: 'white', borderRadius: 12, border: '1px dashed var(--border)', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                    Nothing planned
                  </div>
                ) : (
                  <div style={{ margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {dayEvents.map(ev => {
                      const t = getType(ev.type)
                      return (
                        <div key={ev.id} style={{ background: 'white', borderRadius: 12, padding: '12px 14px', border: '1px solid var(--border)', borderLeft: `4px solid ${t.color}` }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{t.emoji}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 14, fontWeight: 700 }}>{ev.title}</span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: t.color, background: t.bg, padding: '1px 7px', borderRadius: 10 }}>{t.label}</span>
                              </div>
                              {(ev.start_time || ev.end_time) && (
                                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                                  🕐 {ev.start_time?.slice(0,5)}{ev.end_time ? ` – ${ev.end_time.slice(0,5)}` : ''}
                                </div>
                              )}
                              {ev.location && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>📍 {ev.location}</div>}
                              {ev.details && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{ev.details}</div>}
                              {ev.confirmation && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>Ref: {ev.confirmation}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              <button onClick={() => { setEditEvent(ev); setShowForm(true) }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text3)', padding: '2px 5px' }}>✏️</button>
                              <button onClick={() => { if (confirm('Delete this event?')) deleteEvent(ev.id) }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text3)', padding: '2px 5px' }}>🗑</button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Event form modal */}
      {showForm && (
        <EventForm
          trip={trip}
          event={editEvent}
          defaultDate={defaultDate}
          onSave={async (data) => {
            if (editEvent) {
              await supabase.from('trip_events').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editEvent.id)
            } else {
              await supabase.from('trip_events').insert({ ...data, trip_id: trip.id, user_id: session.user.id, created_at: new Date().toISOString() })
            }
            await fetchEvents()
            setShowForm(false)
            setEditEvent(null)
          }}
          onCancel={() => { setShowForm(false); setEditEvent(null) }}
          days={days}
        />
      )}
    </div>
  )
}
