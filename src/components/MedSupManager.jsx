import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from './Toast'

// ─── Add / Edit form ──────────────────────────────────────────────────────────

function ItemForm({ type, userId, existing, onSaved, onCancel, lang }) {
  const isMed = type === 'medication'
  const [name, setName] = useState(existing?.name || '')
  const [dose, setDose] = useState(existing?.dose || '')
  const [scheduledTime, setScheduledTime] = useState(existing?.scheduled_time?.slice(0,5) || '')
  const [instructions, setInstructions] = useState(existing?.instructions || '')
  const [withFood, setWithFood] = useState(existing?.with_food || false)
  const [daily, setDaily] = useState(existing ? existing.active : true)
  const [fasted, setFasted] = useState(existing?.fasted_flag || false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const table = isMed ? 'medications' : 'supplements'
    const payload = {
      user_id: userId,
      name: name.trim(),
      dose: dose.trim() || null,
      scheduled_time: scheduledTime || null,
      active: daily,
    }
    if (isMed) {
      payload.instructions = instructions.trim() || null
      payload.fasted_flag = fasted
    } else {
      payload.with_food = withFood
    }

    if (existing) {
      await supabase.from(table).update(payload).eq('id', existing.id)
    } else {
      await supabase.from(table).insert(payload)
    }
    setSaving(false)
    showToast(lang === 'de' ? 'Gespeichert' : 'Saved')
    onSaved()
  }

  const L = lang === 'de'
    ? { name: 'Name', dose: 'Dosis', time: 'Uhrzeit (täglich)', instructions: 'Hinweise', daily: 'Täglich vorschlagen', fasted: 'Nüchtern einnehmen', withFood: 'Mit Essen', save: existing ? 'Speichern' : 'Hinzufügen', cancel: 'Abbrechen', saving: 'Speichern...' }
    : { name: 'Name', dose: 'Dose', time: 'Scheduled time (daily)', instructions: 'Instructions', daily: 'Suggest daily on Today', fasted: 'Take fasted', withFood: 'Take with food', save: existing ? 'Save' : 'Add', cancel: 'Cancel', saving: 'Saving...' }

  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {existing
          ? (lang === 'de' ? 'Bearbeiten' : 'Edit')
          : isMed
            ? (lang === 'de' ? '+ Medikament hinzufügen' : '+ Add medication')
            : (lang === 'de' ? '+ Supplement hinzufügen' : '+ Add supplement')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label">{L.name}</label>
          <input className="field-input" value={name} onChange={e => setName(e.target.value)}
            placeholder={isMed ? (lang === 'de' ? 'z.B. Levothyroxin' : 'e.g. Levothyroxin') : (lang === 'de' ? 'z.B. Magnesium' : 'e.g. Magnesium')}
            autoFocus />
        </div>
        <div className="field">
          <label className="field-label">{L.dose}</label>
          <input className="field-input" value={dose} onChange={e => setDose(e.target.value)} placeholder={isMed ? '100mcg' : '400mg'} />
        </div>
        <div className="field">
          <label className="field-label">{L.time}</label>
          <input className="field-input" type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
        </div>
        {isMed && (
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label className="field-label">{L.instructions}</label>
            <input className="field-input" value={instructions} onChange={e => setInstructions(e.target.value)}
              placeholder={lang === 'de' ? 'z.B. 30min vor dem Frühstück' : 'e.g. 30min before breakfast'} />
          </div>
        )}
      </div>

      {/* Toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Daily suggestion toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--surface)', borderRadius: 10, border: `1px solid ${daily ? 'var(--green)' : 'var(--border)'}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: daily ? 'var(--green)' : 'var(--text)' }}>{L.daily}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {lang === 'de' ? 'Erscheint täglich im Heute-Tab zum Abhaken' : 'Appears on Today tab every day to check off'}
            </div>
          </div>
          <button onClick={() => setDaily(v => !v)} style={{
            width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
            background: daily ? 'var(--green)' : 'var(--border)', position: 'relative', transition: 'background 0.2s',
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', background: 'white',
              position: 'absolute', top: 3, transition: 'left 0.2s',
              left: daily ? 21 : 3,
            }} />
          </button>
        </div>

        {/* Fasted / with food */}
        {isMed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setFasted(v => !v)} style={{
              width: 22, height: 22, borderRadius: 6, flexShrink: 0,
              border: `1.5px solid ${fasted ? 'var(--amber)' : 'var(--border)'}`,
              background: fasted ? 'rgba(186,117,23,0.15)' : 'var(--surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}>
              {fasted && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>⚡ {L.fasted}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setWithFood(v => !v)} style={{
              width: 22, height: 22, borderRadius: 6, flexShrink: 0,
              border: `1.5px solid ${withFood ? 'var(--green)' : 'var(--border)'}`,
              background: withFood ? 'var(--green-light)' : 'var(--surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}>
              {withFood && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="var(--green)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>🍽 {L.withFood}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1 }}>{L.cancel}</button>
        <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-primary" style={{ flex: 2 }}>
          {saving ? L.saving : L.save}
        </button>
      </div>
    </div>
  )
}

// ─── Single item row ──────────────────────────────────────────────────────────

function ItemRow({ item, type, onEdit, onToggleActive, onDelete, lang }) {
  const isMed = type === 'medication'
  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
        {/* Active indicator */}
        <button onClick={() => onToggleActive(item.id, item.active)} style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          border: `1.5px solid ${item.active ? 'var(--green)' : 'var(--border)'}`,
          background: item.active ? 'var(--green-light)' : 'var(--surface2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          title: item.active ? 'Active — showing on Today' : 'Inactive — tap to reactivate',
        }}>
          {item.active
            ? <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5l3 3 5-5" stroke="var(--green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <div style={{ width: 8, height: 2, background: 'var(--border)', borderRadius: 1 }} />
          }
        </button>

        <div style={{ flex: 1, minWidth: 0 }} onClick={() => onEdit(item)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: item.active ? 'var(--text)' : 'var(--text3)' }}>{item.name}</span>
            {item.dose && (
              <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 10 }}>{item.dose}</span>
            )}
            {item.active && (
              <span style={{ fontSize: 10, color: 'var(--green)', background: 'var(--green-light)', padding: '1px 6px', borderRadius: 10 }}>
                {lang === 'de' ? 'täglich' : 'daily'}
              </span>
            )}
            {!item.active && (
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{lang === 'de' ? 'inaktiv' : 'inactive'}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {item.scheduled_time && <span>⏰ {item.scheduled_time.slice(0,5)}</span>}
            {isMed && item.fasted_flag && <span>⚡ {lang === 'de' ? 'nüchtern' : 'fasted'}</span>}
            {isMed && item.instructions && <span>{item.instructions}</span>}
            {!isMed && item.with_food && <span>🍽 {lang === 'de' ? 'mit Essen' : 'with food'}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onEdit(item)} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
            {lang === 'de' ? 'Edit' : 'Edit'}
          </button>
          <button onClick={() => onDelete(item.id)} style={{ fontSize: 14, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
        </div>
      </div>
    </div>
  )
}

// ─── Section (medications or supplements) ────────────────────────────────────

function Section({ type, userId, items, onReload, lang }) {
  const isMed = type === 'medication'
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)

  const title = isMed ? (lang === 'de' ? '💊 Medikamente' : '💊 Medications') : (lang === 'de' ? '🧴 Supplemente' : '🧴 Supplements')
  const activeCount = items.filter(i => i.active).length
  const table = isMed ? 'medications' : 'supplements'

  async function toggleActive(id, current) {
    await supabase.from(table).update({ active: !current }).eq('id', id)
    onReload()
  }

  async function deleteItem(id) {
    await supabase.from(table).delete().eq('id', id)
    onReload()
    showToast(lang === 'de' ? 'Gelöscht' : 'Deleted')
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {activeCount} {lang === 'de' ? 'aktiv' : 'active'}{items.length > activeCount ? ` · ${items.length - activeCount} ${lang === 'de' ? 'inaktiv' : 'inactive'}` : ''}
        </span>
      </div>

      {items.length === 0 && !showAdd && (
        <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          {lang === 'de' ? 'Noch keine hinzugefügt.' : 'Nothing added yet.'}
        </div>
      )}

      {items.map(item => (
        editing?.id === item.id ? (
          <ItemForm
            key={item.id}
            type={type}
            userId={userId}
            existing={item}
            lang={lang}
            onSaved={() => { setEditing(null); onReload() }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <ItemRow
            key={item.id}
            item={item}
            type={type}
            lang={lang}
            onEdit={setEditing}
            onToggleActive={toggleActive}
            onDelete={deleteItem}
          />
        )
      ))}

      {showAdd ? (
        <ItemForm
          type={type}
          userId={userId}
          lang={lang}
          onSaved={() => { setShowAdd(false); onReload() }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          width: '100%', padding: '11px 14px', background: 'none',
          borderTop: items.length > 0 ? '0.5px solid var(--border)' : 'none',
          border: 'none', color: 'var(--green)', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          {isMed ? (lang === 'de' ? 'Medikament hinzufügen' : 'Add medication') : (lang === 'de' ? 'Supplement hinzufügen' : 'Add supplement')}
        </button>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function MedSupManager({ userId, medications, supplements, onReload, lang }) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text2)', padding: '0 2px 4px', lineHeight: 1.5 }}>
        {lang === 'de'
          ? 'Verwalte deine Medikamente und Supplemente. Aktive Einträge erscheinen täglich im Heute-Tab zum Abhaken mit Zeitstempel.'
          : 'Manage your medications and supplements. Active entries appear on Today every day to check off with a timestamp.'}
      </div>
      <Section type="medication" userId={userId} items={medications} onReload={onReload} lang={lang} />
      <Section type="supplement" userId={userId} items={supplements} onReload={onReload} lang={lang} />
    </>
  )
}
