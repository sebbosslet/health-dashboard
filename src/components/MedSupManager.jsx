import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from './Toast'

function ItemForm({ type, userId, existing, onSaved, onCancel, lang }) {
  const isMed = type === 'medication'

  // Parse existing ingredients
  const parseIngredients = (raw) => {
    if (!raw) return []
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
    catch { return [] }
  }

  const [name, setName] = useState(existing?.name || '')
  const [dose, setDose] = useState(existing?.dose || '')
  const [effectiveFrom, setEffectiveFrom] = useState(existing?.effective_from || '')
  const [multiDose, setMultiDose] = useState(existing?.multi_dose || false)
  const [withFood, setWithFood] = useState(existing?.with_food || false)
  const [fasted, setFasted] = useState(existing?.fasted_flag || false)
  const [daily, setDaily] = useState(existing ? existing.active : true)
  const [multiIngredient, setMultiIngredient] = useState(!!(existing?.ingredients && parseIngredients(existing.ingredients).length > 0))
  const [ingredients, setIngredients] = useState(parseIngredients(existing?.ingredients).length > 0 ? parseIngredients(existing.ingredients) : [{ name: '', dose: '' }])
  const [saving, setSaving] = useState(false)

  function addIngredient() {
    setIngredients(prev => [...prev, { name: '', dose: '' }])
  }
  function removeIngredient(i) {
    setIngredients(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateIngredient(i, field, val) {
    setIngredients(prev => prev.map((ing, idx) => idx === i ? { ...ing, [field]: val } : ing))
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const table = isMed ? 'medications' : 'supplements'
    const payload = { user_id: userId, name: name.trim(), dose: dose.trim() || null, active: daily }
    if (isMed) {
      payload.fasted_flag = fasted
      payload.effective_from = effectiveFrom || null
      payload.multi_dose = multiDose
    } else {
      payload.with_food = withFood
      payload.ingredients = multiIngredient && ingredients.some(i => i.name.trim())
        ? JSON.stringify(ingredients.filter(i => i.name.trim()))
        : null
    }
    if (existing) await supabase.from(table).update(payload).eq('id', existing.id)
    else await supabase.from(table).insert(payload)
    setSaving(false)
    showToast(lang === 'de' ? 'Gespeichert' : 'Saved')
    onSaved()
  }

  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {existing ? (lang === 'de' ? 'Bearbeiten' : 'Edit') : isMed ? (lang === 'de' ? '+ Medikament' : '+ Add medication') : (lang === 'de' ? '+ Supplement' : '+ Add supplement')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label">{lang === 'de' ? 'Name' : 'Name'}</label>
          <input className="field-input" value={name} onChange={e => setName(e.target.value)}
            placeholder={isMed ? 'e.g. Levothyroxin' : 'e.g. Athletic Greens'} autoFocus />
        </div>
        <div className="field">
          <label className="field-label">{lang === 'de' ? 'Dosis' : 'Dose'}</label>
          <input className="field-input" value={dose} onChange={e => setDose(e.target.value)}
            placeholder={isMed ? '100mcg' : '1 scoop / 2 capsules'} />
        </div>
        {isMed && (
          <>
            <div className="field">
              <label className="field-label">{lang === 'de' ? 'Wirksam ab' : 'Effective from'}</label>
              <input className="field-input" type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                {lang === 'de' ? 'Nicht im Heute-Tab wenn Datum in der Zukunft' : 'Hidden on Today if date is in the future'}
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text2)', alignSelf: 'center' }}>
              <input type="checkbox" checked={multiDose} onChange={e => setMultiDose(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
              💊 {lang === 'de' ? 'Mehr als einmal täglich' : 'More than once a day'}
            </label>
          </>
        )}
      </div>

      {/* Flags */}
      <div style={{ display: 'flex', gap: 16 }}>
        {isMed ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text2)' }}>
            <input type="checkbox" checked={fasted} onChange={e => setFasted(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--amber)' }} />
            ⚡ {lang === 'de' ? 'Nüchtern einnehmen' : 'Take fasted'}
          </label>
        ) : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text2)' }}>
            <input type="checkbox" checked={withFood} onChange={e => setWithFood(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--green)' }} />
            🍽 {lang === 'de' ? 'Mit Essen einnehmen' : 'Take with food'}
          </label>
        )}
      </div>

      {/* Multi-ingredient (supplements only) */}
      {!isMed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text2)' }}>
            <input type="checkbox" checked={multiIngredient} onChange={e => {
              setMultiIngredient(e.target.checked)
              if (e.target.checked && ingredients.length === 0) setIngredients([{ name: '', dose: '' }])
            }} style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
            🧪 {lang === 'de' ? 'Hat mehrere Inhaltsstoffe' : 'Has multiple ingredients'}
          </label>

          {multiIngredient && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--surface)', borderRadius: 10, border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                {lang === 'de' ? 'Inhaltsstoffe' : 'Ingredients'}
              </div>
              {ingredients.map((ing, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="field-input"
                    value={ing.name}
                    onChange={e => updateIngredient(i, 'name', e.target.value)}
                    placeholder={lang === 'de' ? 'z.B. Magnesium' : 'e.g. Magnesium'}
                    style={{ flex: 2, fontSize: 12 }}
                  />
                  <input
                    className="field-input"
                    value={ing.dose}
                    onChange={e => updateIngredient(i, 'dose', e.target.value)}
                    placeholder="400mg"
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  {ingredients.length > 1 && (
                    <button onClick={() => removeIngredient(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={addIngredient} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
                background: 'none', border: 'none', color: 'var(--green)', fontSize: 12,
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {lang === 'de' ? 'Inhaltsstoff hinzufügen' : 'Add ingredient'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Daily toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--surface)', borderRadius: 10, border: `1px solid ${daily ? 'var(--green)' : 'var(--border)'}` }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: daily ? 'var(--green)' : 'var(--text)' }}>
            {lang === 'de' ? 'Täglich im Heute-Tab anzeigen' : 'Show on Today every day'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
            {lang === 'de' ? 'Zum Abhaken mit Zeitstempel' : 'Pre-filled to check off with timestamp'}
          </div>
        </div>
        <button onClick={() => setDaily(v => !v)} style={{ width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, background: daily ? 'var(--green)' : 'var(--border)', position: 'relative' }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, left: daily ? 21 : 3, transition: 'left 0.15s' }} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="btn-secondary" style={{ flex: 1 }}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</button>
        <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-primary" style={{ flex: 2 }}>
          {saving ? (lang === 'de' ? 'Speichern...' : 'Saving...') : (lang === 'de' ? 'Speichern' : 'Save')}
        </button>
      </div>
    </div>
  )
}

function Section({ type, userId, items, onReload, lang }) {
  const isMed = type === 'medication'
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const table = isMed ? 'medications' : 'supplements'
  const title = isMed ? (lang === 'de' ? '💊 Medikamente' : '💊 Medications') : (lang === 'de' ? '🧴 Supplemente' : '🧴 Supplements')

  function parseIngredients(raw) {
    if (!raw) return []
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
    catch { return [] }
  }

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
          {items.filter(i => i.active).length}/{items.length} {lang === 'de' ? 'aktiv' : 'active'}
        </span>
      </div>
      {items.length === 0 && !showAdd && (
        <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
          {lang === 'de' ? 'Noch nichts hinzugefügt.' : 'Nothing added yet.'}
        </div>
      )}
      {items.map(item =>
        editing?.id === item.id ? (
          <ItemForm key={item.id} type={type} userId={userId} existing={item} lang={lang}
            onSaved={() => { setEditing(null); onReload() }} onCancel={() => setEditing(null)} />
        ) : (
          <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid var(--border)', opacity: item.active ? 1 : 0.45 }}>
            <button onClick={() => toggleActive(item.id, item.active)} style={{
              width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 1,
              border: `1.5px solid ${item.active ? 'var(--green)' : 'var(--border)'}`,
              background: item.active ? 'var(--green-light)' : 'var(--surface2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}>
              {item.active && <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5l3 3 5-5" stroke="var(--green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</span>
                {item.dose && <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 10 }}>{item.dose}</span>}
                {item.active && <span style={{ fontSize: 10, color: 'var(--green)', background: 'var(--green-light)', padding: '1px 5px', borderRadius: 8 }}>{lang === 'de' ? 'täglich' : 'daily'}</span>}
              </div>
              {/* Ingredient list for multi-ingredient supplements */}
              {!isMed && parseIngredients(item.ingredients).length > 0 && (
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {parseIngredients(item.ingredients).map((ing, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6 }}>
                      <span>· {ing.name}</span>
                      {ing.dose && <span style={{ color: 'var(--text2)' }}>{ing.dose}</span>}
                    </div>
                  ))}
                </div>
              )}
              {((isMed && item.fasted_flag) || (!isMed && item.with_food)) && (
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  {isMed ? (item.fasted_flag ? '⚡ fasted' : '') : '🍽 with food'}
                </div>
              )}
            </div>
            <button onClick={() => setEditing(item)} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Edit</button>
            <button onClick={() => deleteItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, padding: '0 2px', flexShrink: 0 }}>×</button>
          </div>
        )
      )}
      {showAdd ? (
        <ItemForm type={type} userId={userId} lang={lang} onSaved={() => { setShowAdd(false); onReload() }} onCancel={() => setShowAdd(false)} />
      ) : (
        <button onClick={() => setShowAdd(true)} style={{
          width: '100%', padding: '11px 14px', background: 'none', border: 'none',
          borderTop: items.length > 0 ? '0.5px solid var(--border)' : 'none',
          color: 'var(--green)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          {isMed ? (lang === 'de' ? 'Medikament hinzufügen' : 'Add medication') : (lang === 'de' ? 'Supplement hinzufügen' : 'Add supplement')}
        </button>
      )}
    </div>
  )
}

export default function MedSupManager({ userId, medications, supplements, onReload, lang }) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text2)', padding: '0 2px 6px', lineHeight: 1.5 }}>
        {lang === 'de'
          ? 'Deine persönliche Medikamenten- und Supplement-Datenbank. Aktive Einträge erscheinen täglich im Heute-Tab.'
          : 'Your personal medication and supplement database. Active entries appear on Today every day to log with a timestamp.'}
      </div>
      <Section type="medication" userId={userId} items={medications} onReload={onReload} lang={lang} />
      <Section type="supplement" userId={userId} items={supplements} onReload={onReload} lang={lang} />
    </>
  )
}
