import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeDiff(scheduled, actual) {
  if (!scheduled || !actual) return null
  const [sh, sm] = scheduled.split(':').map(Number)
  const [ah, am] = actual.split(':').map(Number)
  const diff = (ah * 60 + am) - (sh * 60 + sm)
  if (Math.abs(diff) < 2) return null
  const abs = Math.abs(diff)
  const label = abs >= 60 ? `${Math.floor(abs/60)}h ${abs%60 > 0 ? abs%60+'m' : ''}`.trim() : `${abs}m`
  return { mins: diff, label, early: diff < 0 }
}

function formatTime(t) {
  if (!t) return ''
  return t.slice(0, 5)
}

// ─── Item Row (single med or supp) ───────────────────────────────────────────

function ItemRow({ item, log, onToggle, onLogTime, type, lang }) {
  const [showTime, setShowTime] = useState(false)
  const [takenTime, setTakenTime] = useState(log?.taken_time?.slice(0,5) || '')
  const [fasted, setFasted] = useState(log?.fasted ?? null)

  const isMed = type === 'medication'
  const taken = log?.taken || false
  const diff = taken && item.scheduled_time && log?.taken_time
    ? timeDiff(item.scheduled_time.slice(0,5), log.taken_time.slice(0,5))
    : null

  async function handleToggle() {
    const nowTime = format(new Date(), 'HH:mm')
    await onToggle(item.id, !taken, !taken ? nowTime : null)
    if (!taken) setTakenTime(nowTime)
  }

  async function handleSaveTime() {
    await onLogTime(item.id, takenTime, fasted)
    setShowTime(false)
    showToast(lang === 'de' ? 'Uhrzeit gespeichert' : 'Time saved')
  }

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>

        {/* Checkbox */}
        <button onClick={handleToggle} style={{
          width: 26, height: 26, borderRadius: 8, border: `1.5px solid ${taken ? 'var(--green)' : 'var(--border)'}`,
          background: taken ? 'var(--green)' : 'var(--surface2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, padding: 0
        }}>
          {taken && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>

        {/* Name + dose */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: taken ? 'var(--text2)' : 'var(--text)', textDecoration: taken ? 'line-through' : 'none' }}>
              {item.name}
            </span>
            {item.dose && (
              <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 10 }}>
                {item.dose}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            {item.scheduled_time && (
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                ⏰ {formatTime(item.scheduled_time)}
              </span>
            )}
            {item.instructions && (
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{item.instructions}</span>
            )}
            {item.with_food && !isMed && (
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>🍽 {lang === 'de' ? 'mit Essen' : 'with food'}</span>
            )}
          </div>
        </div>

        {/* Time taken / diff indicator */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          {taken && log?.taken_time && (
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
              {formatTime(log.taken_time)}
            </span>
          )}
          {diff && (
            <span style={{ fontSize: 9, color: diff.early ? 'var(--blue)' : 'var(--amber)' }}>
              {diff.early ? '↑' : '↓'} {diff.label}
            </span>
          )}
          {taken && (
            <button onClick={() => setShowTime(v => !v)} style={{ fontSize: 9, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
              {showTime ? '▲' : lang === 'de' ? 'bearbeiten' : 'edit'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded time editor */}
      {showTime && taken && (
        <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field-label">{lang === 'de' ? 'Uhrzeit eingenommen' : 'Time taken'}</label>
              <input className="field-input" type="time" value={takenTime} onChange={e => setTakenTime(e.target.value)} />
            </div>
            {isMed && (
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">{lang === 'de' ? 'Nüchtern?' : 'Fasted?'}</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[true, false].map(v => (
                    <button key={String(v)} onClick={() => setFasted(v)} style={{
                      flex: 1, padding: '9px 4px', borderRadius: 8, fontSize: 12,
                      border: `1px solid ${fasted === v ? 'var(--green)' : 'var(--border)'}`,
                      background: fasted === v ? 'var(--green-light)' : 'var(--surface2)',
                      color: fasted === v ? 'var(--green)' : 'var(--text2)',
                      fontWeight: fasted === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit'
                    }}>{v ? '✓' : '✗'}</button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={handleSaveTime} className="btn-primary" style={{ padding: '9px 16px', marginBottom: 0, flexShrink: 0 }}>
              {lang === 'de' ? 'OK' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Container (medications or supplements) ───────────────────────────────────

function TrackingContainer({ type, userId, date, lang }) {
  const isMed = type === 'medication'
  const table = isMed ? 'medications' : 'supplements'
  const logTable = isMed ? 'medication_logs' : 'supplement_logs'
  const idField = isMed ? 'medication_id' : 'supplement_id'

  const [items, setItems] = useState([])
  const [logs, setLogs] = useState({}) // keyed by item id
  const [loading, setLoading] = useState(true)

  async function fetchAll() {
    const [{ data: itemData }, { data: logData }] = await Promise.all([
      supabase.from(table).select('*').eq('user_id', userId).eq('active', true).order('sort_order').order('created_at'),
      supabase.from(logTable).select('*').eq('user_id', userId).eq('date', date),
    ])
    setItems(itemData || [])
    const logMap = {}
    ;(logData || []).forEach(l => { logMap[l[idField]] = l })
    setLogs(logMap)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [date, userId])

  async function handleToggle(itemId, taken, takenTime) {
    const existing = logs[itemId]
    if (existing) {
      await supabase.from(logTable).update({
        taken, taken_time: taken ? takenTime : null, [`${logTable === 'medication_logs' ? 'fasted' : 'note'}`]: null
      }).eq('id', existing.id)
    } else {
      await supabase.from(logTable).insert({
        user_id: userId, date, [idField]: itemId, taken, taken_time: takenTime || null
      })
    }
    fetchAll()
  }

  async function handleLogTime(itemId, takenTime, fasted) {
    const existing = logs[itemId]
    const updates = { taken_time: takenTime }
    if (isMed && fasted !== null) updates.fasted = fasted
    if (existing) {
      await supabase.from(logTable).update(updates).eq('id', existing.id)
    } else {
      await supabase.from(logTable).insert({ user_id: userId, date, [idField]: itemId, taken: true, ...updates })
    }
    fetchAll()
  }

  const takenCount = Object.values(logs).filter(l => l.taken).length
  const totalCount = items.length

  const title = isMed
    ? (lang === 'de' ? '💊 Medikamente' : '💊 Medications')
    : (lang === 'de' ? '🧴 Supplemente' : '🧴 Supplements')

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
              color: takenCount === totalCount ? 'var(--green)' : 'var(--text2)'
            }}>
              {takenCount}/{totalCount}
            </span>
          )}
          {takenCount === totalCount && totalCount > 0 && (
            <span style={{ fontSize: 14 }}>✅</span>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '12px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            {isMed
              ? (lang === 'de' ? 'Noch keine Medikamente' : 'No medications yet')
              : (lang === 'de' ? 'Noch keine Supplemente' : 'No supplements yet')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {lang === 'de' ? 'Füge sie im Profil-Tab hinzu' : 'Add them in the Profile tab → Meds & Supps'}
          </div>
        </div>
      ) : (
        items.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            log={logs[item.id]}
            onToggle={handleToggle}
            onLogTime={handleLogTime}
            type={type}
            lang={lang}
          />
        ))
      )}

      <div style={{ padding: '8px 14px', borderTop: items.length > 0 ? '0.5px solid var(--border)' : 'none' }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
          {lang === 'de' ? '→ Medikamente in Profil verwalten' : '→ Manage in Profile tab'}
        </div>
      </div>
    </div>
  )
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function MedSupTracker({ session, date }) {
  const { lang } = useLang()
  const dateStr = format(date || new Date(), 'yyyy-MM-dd')

  return (
    <>
      <TrackingContainer type="medication" userId={session.user.id} date={dateStr} lang={lang} />
      <TrackingContainer type="supplement" userId={session.user.id} date={dateStr} lang={lang} />
    </>
  )
}
