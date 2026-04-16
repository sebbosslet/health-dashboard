import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

function timeDiff(scheduled, actual) {
  if (!scheduled || !actual) return null
  const [sh, sm] = scheduled.split(':').map(Number)
  const [ah, am] = actual.split(':').map(Number)
  const diff = (ah * 60 + am) - (sh * 60 + sm)
  if (Math.abs(diff) < 2) return null
  const abs = Math.abs(diff)
  const label = abs >= 60 ? `${Math.floor(abs/60)}h${abs%60 ? ` ${abs%60}m` : ''}` : `${abs}m`
  return { label, early: diff < 0 }
}

// ─── Single logged item row ───────────────────────────────────────────────────

function LogRow({ item, log, onToggle, onSaveTime, type, lang }) {
  const isMed = type === 'medication'
  const taken = !!log?.taken
  const [showEdit, setShowEdit] = useState(false)
  const [takenTime, setTakenTime] = useState(log?.taken_time?.slice(0,5) || format(new Date(), 'HH:mm'))
  const diff = taken && log?.taken_time ? timeDiff(null, log.taken_time.slice(0,5)) : null

  async function handleCheck() {
    const now = format(new Date(), 'HH:mm')
    if (!taken) {
      await onToggle(item.id, true, now)
      setTakenTime(now)
    } else {
      await onToggle(item.id, false, null)
    }
  }

  async function handleSaveTime() {
    await onSaveTime(item.id, takenTime)
    setShowEdit(false)
    showToast(lang === 'de' ? 'Gespeichert' : 'Saved')
  }

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        {/* Checkbox */}
        <button onClick={handleCheck} style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          border: `1.5px solid ${taken ? 'var(--green)' : 'var(--border)'}`,
          background: taken ? 'var(--green)' : 'var(--surface2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
        }}>
          {taken && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: taken ? 'var(--text2)' : 'var(--text)', textDecoration: taken ? 'line-through' : 'none' }}>
              {item.name}
            </span>
            {item.dose && <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 10 }}>{item.dose}</span>}
          </div>
          {((isMed && (item.fasted_flag || item.instructions)) || (!isMed && item.with_food)) && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
              {isMed ? [item.fasted_flag && '⚡ fasted', item.instructions].filter(Boolean).join(' · ')
                : '🍽 with food'}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
          {taken && log?.taken_time && (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
              {log.taken_time.slice(0,5)}
            </span>
          )}
          {taken && (
            <button onClick={() => setShowEdit(v => !v)} style={{ fontSize: 10, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {showEdit ? '▲' : lang === 'de' ? 'ändern' : 'edit time'}
            </button>
          )}
        </div>
      </div>

      {/* Inline time editor */}
      {showEdit && taken && (
        <div style={{ padding: '0 14px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="field-input" type="time" value={takenTime} onChange={e => setTakenTime(e.target.value)} style={{ flex: 1 }} />
          <button onClick={handleSaveTime} className="btn-primary" style={{ padding: '8px 16px', flexShrink: 0 }}>OK</button>
        </div>
      )}
    </div>
  )
}

// ─── Add from master (picker) ─────────────────────────────────────────────────

function AddFromMaster({ type, userId, date, allItems, loggedIds, onAdded, onCancel, lang }) {
  const isMed = type === 'medication'
  // Show: non-daily items not yet logged today (active daily items are already in main list)
  const available = allItems.filter(i => !i.active && !loggedIds.has(i.id))
  const [selectedId, setSelectedId] = useState(null)
  const [takenTime, setTakenTime] = useState(format(new Date(), 'HH:mm'))
  const [saving, setSaving] = useState(false)

  const logTable = isMed ? 'medication_logs' : 'supplement_logs'
  const idField = isMed ? 'medication_id' : 'supplement_id'

  async function handleAdd() {
    if (!selectedId) return
    setSaving(true)
    const { error } = await supabase.from(logTable).insert({
      user_id: userId, date, [idField]: selectedId,
      taken: true, taken_time: takenTime || null,
    })
    if (error) console.error('Log error:', error)
    setSaving(false)
    onAdded()
    showToast(lang === 'de' ? 'Geloggt' : 'Logged')
  }

  if (available.length === 0) {
    return (
      <div style={{ padding: '10px 14px 12px', background: 'var(--surface2)', borderTop: '0.5px solid var(--border)' }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          {lang === 'de' ? 'Alle Einträge bereits geloggt.' : 'All items already logged.'}
        </div>
        <button onClick={onCancel} className="btn-secondary" style={{ width: '100%' }}>{lang === 'de' ? 'Schließen' : 'Close'}</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '10px 14px 12px', background: 'var(--surface2)', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {isMed ? (lang === 'de' ? 'Medikament hinzufügen' : 'Log medication') : (lang === 'de' ? 'Supplement hinzufügen' : 'Log supplement')}
      </div>

      {/* Item picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {available.map(item => (
          <button key={item.id} onClick={() => setSelectedId(item.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
            borderRadius: 8, border: `1.5px solid ${selectedId === item.id ? 'var(--green)' : 'var(--border)'}`,
            background: selectedId === item.id ? 'var(--green-light)' : 'var(--surface)',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: selectedId === item.id ? 'var(--green)' : 'var(--text)' }}>{item.name}</span>
              {item.dose && <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{item.dose}</span>}
            </div>
            {selectedId === item.id && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-6" stroke="var(--green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </button>
        ))}
      </div>

      {/* Time — prefills to now, always visible */}
      {selectedId && (
        <div className="field">
          <label className="field-label">⏰ {lang === 'de' ? 'Uhrzeit eingenommen' : 'Time taken'}</label>
          <input className="field-input" type="time" value={takenTime} onChange={e => setTakenTime(e.target.value)} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1 }}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</button>
        <button onClick={handleAdd} disabled={!selectedId || saving} className="btn-primary" style={{ flex: 2 }}>
          {saving ? '...' : (lang === 'de' ? 'Hinzufügen' : 'Add')}
        </button>
      </div>
    </div>
  )
}

// ─── Container ────────────────────────────────────────────────────────────────

function Container({ type, userId, date, lang }) {
  const isMed = type === 'medication'
  const table = isMed ? 'medications' : 'supplements'
  const logTable = isMed ? 'medication_logs' : 'supplement_logs'
  const idField = isMed ? 'medication_id' : 'supplement_id'

  const [allItems, setAllItems] = useState([])   // full master list
  const [logs, setLogs] = useState({})           // keyed by item id
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)

  const dailyItems = allItems.filter(i => i.active) // pre-suggested items

  async function fetchAll() {
    const [{ data: items }, { data: logData }] = await Promise.all([
      supabase.from(table).select('*').eq('user_id', userId).order('created_at'),
      supabase.from(logTable).select('*').eq('user_id', userId).eq('date', date),
    ])
    setAllItems(items || [])
    const logMap = {}
    ;(logData || []).forEach(l => { logMap[l[idField]] = l })
    setLogs(logMap)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [date, userId])

  async function handleToggle(itemId, taken, takenTime) {
    const existing = logs[itemId]
    if (existing) {
      await supabase.from(logTable).update({ taken, taken_time: taken ? takenTime : null }).eq('id', existing.id)
    } else {
      await supabase.from(logTable).insert({ user_id: userId, date, [idField]: itemId, taken, taken_time: takenTime || null })
    }
    fetchAll()
  }

  async function handleSaveTime(itemId, takenTime) {
    const existing = logs[itemId]
    if (existing) await supabase.from(logTable).update({ taken_time: takenTime }).eq('id', existing.id)
    fetchAll()
  }

  // Items to show: daily items + any non-daily items that were manually logged today
  const manuallyLogged = allItems.filter(i => !i.active && logs[i.id])
  const displayItems = [...dailyItems, ...manuallyLogged]
  const takenCount = displayItems.filter(i => logs[i.id]?.taken).length
  const title = isMed ? (lang === 'de' ? '💊 Medikamente' : '💊 Medications') : (lang === 'de' ? '🧴 Supplemente' : '🧴 Supplements')
  const loggedIds = new Set(Object.keys(logs))

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        {displayItems.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: takenCount === displayItems.length ? 'var(--green)' : 'var(--text2)' }}>
            {takenCount}/{displayItems.length} {takenCount === displayItems.length && '✅'}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>...</div>
      ) : displayItems.length === 0 && !showAdd ? (
        <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 }}>
          {lang === 'de' ? 'Keine aktiven Einträge — füge sie in Profil → Meds & Supps hinzu.' : 'No active entries — add them in Profile → Meds & Supps.'}
        </div>
      ) : (
        displayItems.map(item => (
          <LogRow
            key={item.id}
            item={item}
            log={logs[item.id]}
            onToggle={handleToggle}
            onSaveTime={handleSaveTime}
            type={type}
            lang={lang}
          />
        ))
      )}

      {showAdd ? (
        <AddFromMaster
          type={type}
          userId={userId}
          date={date}
          allItems={allItems}
          loggedIds={loggedIds}
          lang={lang}
          onAdded={() => { setShowAdd(false); fetchAll() }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          width: '100%', padding: '9px 14px',
          borderTop: displayItems.length > 0 ? '0.5px solid var(--border)' : 'none',
          background: 'none', border: 'none', color: 'var(--green)', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.5v10M1.5 6.5h10" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          {isMed ? (lang === 'de' ? 'Weiteres Medikament loggen' : 'Log another medication') : (lang === 'de' ? 'Weiteres Supplement loggen' : 'Log another supplement')}
        </button>
      )}
    </div>
  )
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function MedSupTracker({ session, date }) {
  const { lang } = useLang()
  const dateStr = format(date || new Date(), 'yyyy-MM-dd')
  return (
    <>
      <Container type="medication" userId={session.user.id} date={dateStr} lang={lang} />
      <Container type="supplement" userId={session.user.id} date={dateStr} lang={lang} />
    </>
  )
}
