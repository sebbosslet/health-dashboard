import { useState, useEffect } from 'react'
import { format, subDays, differenceInDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

// ─── Event type definitions ───────────────────────────────────────────────────

const EVENT_TYPES = [
  { key: 'travel',    emoji: '✈️',  color: 'var(--blue)',   bg: 'rgba(26,92,158,0.07)',   labelEN: 'Travel',       labelDE: 'Reise' },
  { key: 'stress',    emoji: '😰',  color: 'var(--red)',    bg: 'rgba(194,48,48,0.07)',   labelEN: 'Stress',       labelDE: 'Stress' },
  { key: 'work',      emoji: '💼',  color: 'var(--amber)',  bg: 'rgba(186,117,23,0.07)',  labelEN: 'Work',         labelDE: 'Arbeit' },
  { key: 'social',    emoji: '🤝',  color: 'var(--green)',  bg: 'rgba(26,122,94,0.07)',   labelEN: 'Social',       labelDE: 'Soziales' },
  { key: 'health',    emoji: '🏥',  color: 'var(--purple)', bg: 'rgba(107,63,160,0.07)',  labelEN: 'Health',       labelDE: 'Gesundheit' },
  { key: 'custom',    emoji: '📌',  color: 'var(--text2)',  bg: 'var(--surface2)',        labelEN: 'Other',        labelDE: 'Sonstiges' },
]

const TRAVEL_PRESETS = [
  { from: 'ET',  to: 'CET',  offset: 6,  label: 'ET → CET' },
  { from: 'CET', to: 'ET',   offset: -6, label: 'CET → ET' },
  { from: 'ET',  to: 'BST',  offset: 5,  label: 'ET → London' },
  { from: 'BST', to: 'ET',   offset: -5, label: 'London → ET' },
  { from: 'CET', to: 'EST',  offset: -6, label: 'CET → ET' },
]

const QUICK_EVENTS = {
  en: [
    { type: 'work',   emoji: '🎤', label: 'Big presentation' },
    { type: 'work',   emoji: '🤝', label: 'Important meeting' },
    { type: 'stress', emoji: '😰', label: 'High stress day' },
    { type: 'social', emoji: '😄', label: 'Great conversation' },
    { type: 'social', emoji: '👨‍👩‍👧', label: 'Family time' },
    { type: 'health', emoji: '🤒', label: 'Feeling unwell' },
    { type: 'work',   emoji: '🚗', label: 'Long drive' },
    { type: 'social', emoji: '🎉', label: 'Social event' },
    { type: 'work',   emoji: '🏆', label: 'Business win' },
    { type: 'stress', emoji: '💭', label: 'Emotional stress' },
    { type: 'social', emoji: '📞', label: 'Good phone call' },
    { type: 'health', emoji: '💊', label: 'Doctor appointment' },
  ],
  de: [
    { type: 'work',   emoji: '🎤', label: 'Große Präsentation' },
    { type: 'work',   emoji: '🤝', label: 'Wichtiges Meeting' },
    { type: 'stress', emoji: '😰', label: 'Stressiger Tag' },
    { type: 'social', emoji: '😄', label: 'Tolles Gespräch' },
    { type: 'social', emoji: '👨‍👩‍👧', label: 'Familienzeit' },
    { type: 'health', emoji: '🤒', label: 'Nicht gut gefühlt' },
    { type: 'work',   emoji: '🚗', label: 'Lange Fahrt' },
    { type: 'social', emoji: '🎉', label: 'Soziales Event' },
    { type: 'work',   emoji: '🏆', label: 'Beruflicher Erfolg' },
    { type: 'stress', emoji: '💭', label: 'Emotionaler Stress' },
    { type: 'social', emoji: '📞', label: 'Gutes Telefonat' },
    { type: 'health', emoji: '💊', label: 'Arzttermin' },
  ]
}

function getEventTypeMeta(key) {
  return EVENT_TYPES.find(t => t.key === key) || EVENT_TYPES[EVENT_TYPES.length - 1]
}

// ─── Travel state banner ──────────────────────────────────────────────────────

function TravelBanner({ travelState, userId, onBack, lang }) {
  const [confirming, setConfirming] = useState(false)
  const days = differenceInDays(new Date(), new Date(travelState.departure_date))

  async function handleBack() {
    await supabase.from('travel_state').update({ active: false, updated_at: new Date().toISOString() }).eq('user_id', userId)
    // Log return event
    await supabase.from('daily_events').insert({
      user_id: userId,
      date: format(new Date(), 'yyyy-MM-dd'),
      event_type: 'travel',
      label: lang === 'de' ? `Zurück zu ${travelState.timezone_from}` : `Back to ${travelState.timezone_from}`,
      timezone_from: travelState.timezone_to,
      timezone_to: travelState.timezone_from,
      timezone_offset: -(travelState.timezone_offset || 0),
      travel_active: false,
    })
    onBack()
    showToast(lang === 'de' ? 'Reise beendet' : 'Travel ended')
  }

  return (
    <div style={{
      background: 'rgba(26,92,158,0.07)', border: '0.5px solid rgba(26,92,158,0.25)',
      borderRadius: 10, padding: '10px 12px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>✈️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)' }}>
          {travelState.label} · {lang === 'de' ? `${days} Tag${days !== 1 ? 'e' : ''} unterwegs` : `Day ${days + 1} away`}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
          {travelState.timezone_offset > 0 ? '+' : ''}{travelState.timezone_offset}h {lang === 'de' ? 'Zeitunterschied · beeinflusst Schlafanalyse' : 'time difference · affecting sleep analysis'}
        </div>
      </div>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} style={{
          padding: '5px 10px', borderRadius: 14, border: '0.5px solid rgba(26,92,158,0.3)',
          background: 'none', color: 'var(--blue)', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0
        }}>
          {lang === 'de' ? 'Zurück' : 'Back home'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setConfirming(false)} style={{ padding: '5px 8px', borderRadius: 12, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
            {lang === 'de' ? 'Nein' : 'No'}
          </button>
          <button onClick={handleBack} style={{ padding: '5px 10px', borderRadius: 12, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {lang === 'de' ? 'Ja, ich bin zurück' : 'Yes, I\'m back'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Add event form ───────────────────────────────────────────────────────────

function AddEventForm({ userId, date, lang, onSaved, onCancel }) {
  const [step, setStep] = useState('type') // 'type' | 'travel' | 'quick' | 'custom'
  const [selectedType, setSelectedType] = useState(null)
  const [customLabel, setCustomLabel] = useState('')
  const [customDetail, setCustomDetail] = useState('')
  const [travelPreset, setTravelPreset] = useState(null)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [customOffset, setCustomOffset] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveEvent(eventData) {
    setSaving(true)
    await supabase.from('daily_events').insert({ user_id: userId, date, ...eventData })

    // If travel, update travel_state
    if (eventData.event_type === 'travel' && eventData.travel_active) {
      await supabase.from('travel_state').upsert({
        user_id: userId,
        timezone_from: eventData.timezone_from,
        timezone_to: eventData.timezone_to,
        timezone_offset: eventData.timezone_offset,
        departure_date: date,
        label: eventData.label,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    }

    setSaving(false)
    onSaved()
    showToast(lang === 'de' ? 'Ereignis gespeichert' : 'Event saved')
  }

  async function handleQuickEvent(evt) {
    await saveEvent({
      event_type: evt.type,
      label: `${evt.emoji} ${evt.label}`,
    })
  }

  async function handleTravelSave() {
    const tz = travelPreset || { from: customFrom, to: customTo, offset: parseInt(customOffset) || 0 }
    await saveEvent({
      event_type: 'travel',
      label: `✈️ ${tz.from} → ${tz.to}`,
      timezone_from: tz.from,
      timezone_to: tz.to,
      timezone_offset: tz.offset,
      travel_active: true,
    })
  }

  async function handleCustomSave() {
    if (!customLabel.trim()) return
    const meta = getEventTypeMeta(selectedType)
    await saveEvent({
      event_type: selectedType,
      label: `${meta.emoji} ${customLabel.trim()}`,
      detail: customDetail.trim() || null,
    })
  }

  return (
    <div style={{ padding: '10px 14px 14px', borderTop: '0.5px solid var(--border)', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {step === 'type' && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {lang === 'de' ? '+ Was ist heute passiert?' : '+ What happened today?'}
          </div>

          {/* Quick events */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
              {lang === 'de' ? 'Schnellauswahl' : 'Quick add'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_EVENTS[lang === 'de' ? 'de' : 'en'].map((evt, i) => (
                <button key={i} onClick={() => handleQuickEvent(evt)} disabled={saving} style={{
                  padding: '6px 10px', borderRadius: 20,
                  border: `0.5px solid ${getEventTypeMeta(evt.type).color}40`,
                  background: getEventTypeMeta(evt.type).bg,
                  color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {evt.emoji} {evt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Travel button */}
          <button onClick={() => setStep('travel')} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
            borderRadius: 10, border: '0.5px solid rgba(26,92,158,0.3)',
            background: 'rgba(26,92,158,0.05)', cursor: 'pointer', fontFamily: 'inherit', width: '100%',
          }}>
            <span style={{ fontSize: 18 }}>✈️</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue)' }}>
                {lang === 'de' ? 'Reise loggen' : 'Log travel'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {lang === 'de' ? 'Zeitzone · Schlafanalyse berücksichtigt Jetlag' : 'Timezone · sleep analysis will account for jet lag'}
              </div>
            </div>
          </button>

          {/* Custom event */}
          <button onClick={() => { setSelectedType('custom'); setStep('custom') }} style={{
            padding: '8px 12px', borderRadius: 10, border: '0.5px solid var(--border)',
            background: 'none', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            {lang === 'de' ? 'Eigenes Ereignis' : 'Custom event'}
          </button>

          <button onClick={onCancel} style={{ padding: '8px', background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            {lang === 'de' ? 'Abbrechen' : 'Cancel'}
          </button>
        </>
      )}

      {step === 'travel' && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)' }}>✈️ {lang === 'de' ? 'Reise loggen' : 'Log travel'}</div>

          {/* Presets */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TRAVEL_PRESETS.map((p, i) => (
              <button key={i} onClick={() => setTravelPreset(p)} style={{
                padding: '7px 12px', borderRadius: 20, fontSize: 12,
                border: `1.5px solid ${travelPreset?.label === p.label ? 'var(--blue)' : 'var(--border)'}`,
                background: travelPreset?.label === p.label ? 'rgba(26,92,158,0.1)' : 'var(--surface)',
                color: travelPreset?.label === p.label ? 'var(--blue)' : 'var(--text2)',
                fontWeight: travelPreset?.label === p.label ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{p.label}</button>
            ))}
          </div>

          {/* Custom timezone */}
          {!travelPreset && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="field">
                <label className="field-label">{lang === 'de' ? 'Von' : 'From'}</label>
                <input className="field-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} placeholder="ET" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="field">
                <label className="field-label">{lang === 'de' ? 'Nach' : 'To'}</label>
                <input className="field-input" value={customTo} onChange={e => setCustomTo(e.target.value)} placeholder="CET" style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="field">
                <label className="field-label">{lang === 'de' ? 'Diff (h)' : 'Offset (h)'}</label>
                <input className="field-input" type="number" value={customOffset} onChange={e => setCustomOffset(e.target.value)} placeholder="+6" inputMode="numeric" />
              </div>
            </div>
          )}

          {travelPreset && (
            <div style={{ fontSize: 12, color: 'var(--text2)', background: 'rgba(26,92,158,0.06)', borderRadius: 8, padding: '8px 10px' }}>
              {travelPreset.offset > 0 ? '+' : ''}{travelPreset.offset}h {lang === 'de' ? 'Zeitdifferenz · App fragt täglich bis du zurückfliegst' : 'time difference · app asks daily until you fly back'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setStep('type'); setTravelPreset(null) }} className="btn-secondary">{lang === 'de' ? 'Zurück' : 'Back'}</button>
            <button onClick={handleTravelSave} className="btn-primary" disabled={saving || (!travelPreset && (!customFrom || !customTo))} style={{ flex: 1 }}>
              {saving ? '...' : (lang === 'de' ? 'Reise starten' : 'Start travel')}
            </button>
          </div>
        </>
      )}

      {step === 'custom' && (
        <>
          {/* Type selector */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EVENT_TYPES.filter(t => t.key !== 'custom').map(t => (
              <button key={t.key} onClick={() => setSelectedType(t.key)} style={{
                padding: '6px 12px', borderRadius: 20, fontSize: 12,
                border: `1.5px solid ${selectedType === t.key ? t.color : 'var(--border)'}`,
                background: selectedType === t.key ? t.bg : 'var(--surface)',
                color: selectedType === t.key ? t.color : 'var(--text2)',
                fontWeight: selectedType === t.key ? 600 : 400,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{t.emoji} {lang === 'de' ? t.labelDE : t.labelEN}</button>
            ))}
          </div>

          <div className="field">
            <label className="field-label">{lang === 'de' ? 'Beschreibung' : 'What happened?'}</label>
            <input className="field-input" value={customLabel} onChange={e => setCustomLabel(e.target.value)}
              placeholder={lang === 'de' ? 'z.B. Langer Arbeitstag, wichtige Entscheidung...' : 'e.g. Long workday, important decision...'} autoFocus />
          </div>

          <div className="field">
            <label className="field-label">{lang === 'de' ? 'Details (optional)' : 'Details (optional)'}</label>
            <input className="field-input" value={customDetail} onChange={e => setCustomDetail(e.target.value)}
              placeholder={lang === 'de' ? 'Mehr Kontext...' : 'More context...'} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setStep('type')} className="btn-secondary">{lang === 'de' ? 'Zurück' : 'Back'}</button>
            <button onClick={handleCustomSave} className="btn-primary" disabled={saving || !customLabel.trim() || !selectedType} style={{ flex: 1 }}>
              {saving ? '...' : (lang === 'de' ? 'Speichern' : 'Save')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Event chip ───────────────────────────────────────────────────────────────

function EventChip({ event, onDelete, lang }) {
  const meta = getEventTypeMeta(event.event_type)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 20,
      border: `0.5px solid ${meta.color}40`,
      background: meta.bg,
    }}>
      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{event.label}</span>
      {event.detail && (
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>· {event.detail}</span>
      )}
      <button onClick={() => onDelete(event.id)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text3)', fontSize: 13, padding: 0, lineHeight: 1,
        display: 'flex', alignItems: 'center',
      }}>×</button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DailyContext({ session, date }) {
  const { lang } = useLang()
  const [events, setEvents] = useState([])
  const [travelState, setTravelState] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const dateStr = format(date || new Date(), 'yyyy-MM-dd')

  useEffect(() => { fetchAll() }, [dateStr, session.user.id])

  async function fetchAll() {
    const [{ data: evts }, { data: travel }] = await Promise.all([
      supabase.from('daily_events').select('*').eq('user_id', session.user.id).eq('date', dateStr).order('created_at'),
      supabase.from('travel_state').select('*').eq('user_id', session.user.id).eq('active', true).maybeSingle(),
    ])
    setEvents(evts || [])
    setTravelState(travel)
  }

  async function deleteEvent(id) {
    await supabase.from('daily_events').delete().eq('id', id)
    fetchAll()
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">📌 {lang === 'de' ? 'Tages-Kontext' : 'Day context'}</span>
        {events.length > 0 && (
          <span className="badge" style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '0.5px solid var(--border)' }}>
            {events.length}
          </span>
        )}
      </div>

      {/* Active travel banner */}
      {travelState && (
        <div style={{ padding: '8px 14px', borderBottom: '0.5px solid var(--border)' }}>
          <TravelBanner travelState={travelState} userId={session.user.id} onBack={fetchAll} lang={lang} />
        </div>
      )}

      {/* Today's events */}
      {events.length > 0 && (
        <div style={{ padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '0.5px solid var(--border)' }}>
          {events.map(evt => (
            <EventChip key={evt.id} event={evt} onDelete={deleteEvent} lang={lang} />
          ))}
        </div>
      )}

      {/* Add form */}
      {showAdd ? (
        <AddEventForm
          userId={session.user.id}
          date={dateStr}
          lang={lang}
          onSaved={() => { setShowAdd(false); fetchAll() }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          width: '100%', padding: '10px 14px', background: 'none', border: 'none',
          color: events.length > 0 ? 'var(--text2)' : 'var(--green)',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          {events.length === 0
            ? (lang === 'de' ? 'Kontext für heute hinzufügen' : 'Add context for today')
            : (lang === 'de' ? 'Weiteres hinzufügen' : 'Add another')}
        </button>
      )}
    </div>
  )
}
