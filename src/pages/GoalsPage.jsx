import { useLang } from '../lib/LangContext'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'

const TIMEFRAMES = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
]

const DEFAULT_CATEGORIES = ['Nutrition', 'Activity', 'Evening habits', 'Sleep', 'Body', 'Custom']

const DEFAULT_GOALS = [
  { name: 'Daily calories', category: 'Nutrition', target_value: 1900, timeframe: 'day' },
  { name: 'Daily water', category: 'Nutrition', target_value: 2500, timeframe: 'day' },
  { name: 'Weight loss', category: 'Body', target_value: 0.5, timeframe: 'week' },
  { name: 'Gym sessions', category: 'Activity', target_value: 3, timeframe: 'week' },
  { name: 'Run', category: 'Activity', target_value: 2, timeframe: 'week' },
  { name: 'Sauna', category: 'Activity', target_value: 2, timeframe: 'week' },
  { name: 'Reading', category: 'Evening habits', target_value: 7, timeframe: 'week' },
  { name: 'Meditation', category: 'Evening habits', target_value: 5, timeframe: 'week' },
  { name: 'Journaling', category: 'Evening habits', target_value: 3, timeframe: 'week' },
  { name: 'Sleep duration', category: 'Sleep', target_value: 8, timeframe: 'day' },
  { name: 'Recovery score', category: 'Sleep', target_value: 67, timeframe: 'day' },
]

function GoalRow({ goal, onEdit }) {
  return (
    <div onClick={() => onEdit(goal)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid var(--border)', cursor: 'pointer' }}>
      {goal.emoji && <span style={{ fontSize: 18, flexShrink: 0 }}>{goal.emoji}</span>}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{goal.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
          {goal.effective_from ? format(new Date(goal.effective_from), 'd MMM yyyy') : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{goal.target_value}</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>/ {goal.timeframe}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </div>
  )
}

export default function GoalsPage({ session }) {
  const { t, lang } = useLang()
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [isNew, setIsNew] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [mode, setMode] = useState('goal') // 'goal' or 'category'
  const [customCategories, setCustomCategories] = useState([])

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('Activity')
  const [editValue, setEditValue] = useState('')
  const [editTimeframe, setEditTimeframe] = useState('week')
  const [editEffective, setEditEffective] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [editEmoji, setEditEmoji] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategoryName, setEditingCategoryName] = useState(null) // category being renamed

  async function fetchGoals() {
    const { data } = await supabase.from('goals').select('*').eq('user_id', session.user.id).order('category').order('name')
    setGoals(data || [])
    // Derive any custom categories from existing goals
    const cats = [...new Set((data || []).map(g => g.category))].filter(c => !DEFAULT_CATEGORIES.includes(c))
    setCustomCategories(cats)
    setLoading(false)
  }

  useEffect(() => { fetchGoals() }, [session.user.id])

  function openEdit(goal) {
    setEditing(goal)
    setIsNew(false)
    setMode('goal')
    setEditName(goal.name)
    setEditCategory(goal.category)
    setEditValue(String(goal.target_value))
    setEditTimeframe(goal.timeframe)
    setEditEffective(goal.effective_from || format(new Date(), 'yyyy-MM-dd'))
    setEditEmoji(goal.emoji || '')
    setShowDeleteConfirm(false)
  }

  function openNew() {
    setEditing({ id: null })
    setIsNew(true)
    setMode('goal')
    setEditName('')
    setEditCategory('Activity')
    setEditValue('')
    setEditTimeframe('week')
    setEditEffective(format(new Date(), 'yyyy-MM-dd'))
    setNewCategoryName('')
    setEditEmoji('')
    setShowDeleteConfirm(false)
  }

  async function handleSave() {
    if (mode === 'category') {
      if (!newCategoryName.trim()) return
      setCustomCategories(prev => [...new Set([...prev, newCategoryName.trim()])])
      setEditing(null)
      showToast(lang === 'de' ? 'Kategorie hinzugefügt' : 'Category added')
      return
    }
    const payload = {
      user_id: session.user.id,
      name: editName,
      category: editCategory,
      target_value: parseFloat(editValue),
      timeframe: editTimeframe,
      effective_from: editEffective,
      emoji: editEmoji || null,
    }
    if (isNew) {
      const { error } = await supabase.from('goals').insert(payload)
      if (!error) { showToast(t('goals_added')); fetchGoals(); setEditing(null) }
    } else {
      const { error } = await supabase.from('goals').update(payload).eq('id', editing.id)
      if (!error) { showToast(t('goals_saved')); fetchGoals(); setEditing(null) }
    }
  }

  async function handleDelete() {
    const { error } = await supabase.from('goals').delete().eq('id', editing.id)
    if (!error) { showToast(t('goals_deleted')); fetchGoals(); setEditing(null) }
  }

  async function seedDefaultGoals() {
    const rows = DEFAULT_GOALS.map(g => ({ ...g, user_id: session.user.id, effective_from: format(new Date(), 'yyyy-MM-dd') }))
    await supabase.from('goals').insert(rows)
    fetchGoals()
    showToast(t('goals_defaults_added'))
  }

  const allCategories = [...DEFAULT_CATEGORIES.filter(c => c !== 'Custom'), ...customCategories]

  const grouped = allCategories.reduce((acc, cat) => {
    const catGoals = goals.filter(g => g.category === cat)
    if (catGoals.length) acc[cat] = catGoals
    return acc
  }, {})

  // Also catch any goals with categories not in our list
  goals.forEach(g => {
    if (!allCategories.includes(g.category)) {
      if (!grouped[g.category]) grouped[g.category] = []
      grouped[g.category].push(g)
    }
  })

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">{t('goals_title')}</div>
          <div className="page-header-sub">{goals.length} {lang === 'de' ? 'Ziele aktiv' : 'goals active'}</div>
        </div>
        <button onClick={openNew} style={{ padding: '7px 14px', borderRadius: 20, background: 'var(--green)', border: 'none', color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          + {lang === 'de' ? 'Neu' : 'New'}
        </button>
      </div>

      <div className="page-section">
        {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)' }}>Loading...</div>}

        {!loading && goals.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 16 }}>{t('goals_none')}</div>
            <button className="btn-primary" onClick={seedDefaultGoals}>{t('goals_load_defaults')}</button>
          </div>
        )}

        {Object.entries(grouped).map(([cat, catGoals]) => (
          <div key={cat} className="card">
            <div className="card-header">
              {editingCategoryName === cat ? (
                <input
                  className="field-input" autoFocus
                  defaultValue={cat}
                  onBlur={async e => {
                    const newName = e.target.value.trim()
                    if (newName && newName !== cat) {
                      await Promise.all(catGoals.map(g =>
                        supabase.from('goals').update({ category: newName }).eq('id', g.id)
                      ))
                      fetchGoals()
                      showToast('Category renamed')
                    }
                    setEditingCategoryName(null)
                  }}
                  onKeyDown={e => e.key === 'Escape' && setEditingCategoryName(null)}
                  style={{ fontSize: 13, fontWeight: 700, width: '60%' }}
                />
              ) : (
                <span className="card-title" onClick={() => setEditingCategoryName(cat)} style={{ cursor: 'pointer' }} title="Tap to rename">
                  {cat} ✏️
                </span>
              )}
              <span className="badge" style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '0.5px solid var(--border)' }}>{catGoals.length}</span>
            </div>
            {catGoals.map(g => <GoalRow key={g.id} goal={g} onEdit={openEdit} />)}
          </div>
        ))}

        <div style={{ height: 8 }} />
      </div>

      {/* Edit / New sheet */}
      {editing && (
        <div className="sheet-overlay" onClick={() => setEditing(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{isNew ? t('goals_new_title') : t('goals_edit_title')}</div>
            <div className="sheet-divider" />

            {/* Mode toggle - only shown when creating new */}
            {isNew && (
              <div style={{ display: 'flex', gap: 6, padding: '0 16px 14px' }}>
                {['goal', 'category'].map(m => (
                  <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: `0.5px solid ${mode === m ? 'var(--green-border)' : 'var(--border)'}`, background: mode === m ? 'var(--green-light)' : 'var(--surface2)', color: mode === m ? 'var(--green)' : 'var(--text2)', fontWeight: mode === m ? 600 : 400, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {m === 'goal' ? (lang === 'de' ? '🎯 Ziel' : '🎯 Goal') : (lang === 'de' ? '📁 Kategorie' : '📁 Category')}
                  </button>
                ))}
              </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {mode === 'category' ? (
                // Category creation mode
                <>
                  <div className="field">
                    <label className="field-label">{lang === 'de' ? 'Kategoriename' : 'Category name'}</label>
                    <input className="field-input" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder={lang === 'de' ? 'z.B. Beweglichkeit' : 'e.g. Mobility'} autoFocus />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                    {lang === 'de' ? 'Die Kategorie erscheint beim Erstellen neuer Ziele.' : 'The category will appear when creating new goals.'}
                  </div>
                </>
              ) : (
                // Goal creation/edit mode
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', gap: 8 }}>
                    <div className="field">
                      <label className="field-label">{t('goals_name')}</label>
                      <input className="field-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder={lang === 'de' ? 'z.B. Laufen' : 'e.g. Running'} />
                    </div>
                    {true && (
                      <div className="field">
                        <label className="field-label">Icon</label>
                        <input className="field-input" value={editEmoji} onChange={e => setEditEmoji(e.target.value)} placeholder="🏋️" style={{ textAlign: 'center', fontSize: 18, padding: '6px 4px' }} maxLength={4} />
                      </div>
                    )}
                  </div>

                  <div className="field">
                    <label className="field-label">{t('goals_category')}</label>
                    <select className="field-input" value={editCategory} onChange={e => setEditCategory(e.target.value)} style={{ cursor: 'pointer' }}>
                      {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="field">
                      <label className="field-label">{t('goals_target')}</label>
                      <input className="field-input" type="number" step="0.1" value={editValue} onChange={e => setEditValue(e.target.value)} inputMode="decimal" />
                    </div>
                    <div className="field">
                      <label className="field-label">{t('goals_timeframe')}</label>
                      <select className="field-input" value={editTimeframe} onChange={e => setEditTimeframe(e.target.value)} style={{ cursor: 'pointer' }}>
                        {TIMEFRAMES.map(tf => <option key={tf.key} value={tf.key}>{lang === 'de' ? { day: 'Tag', week: 'Woche', month: 'Monat', quarter: 'Quartal', year: 'Jahr' }[tf.key] : tf.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {editName && editValue && (
                    <div style={{ background: 'var(--green-light)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
                      {editValue} × {editName} / {editTimeframe}
                    </div>
                  )}

                  <div className="field">
                    <label className="field-label">{t('goals_effective_from')}</label>
                    <input className="field-input" type="date" value={editEffective} onChange={e => setEditEffective(e.target.value)} />
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{t('goals_effective_sub')}</div>
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setEditing(null)}>{t('goals_cancel')}</button>
                <button className="btn-primary" onClick={handleSave} disabled={mode === 'goal' ? (!editName || !editValue) : !newCategoryName.trim()} style={{ flex: 1 }}>
                  {isNew ? (lang === 'de' ? 'Hinzufügen' : 'Add') : t('goals_save')}
                </button>
                {!isNew && !showDeleteConfirm && (
                  <button onClick={() => setShowDeleteConfirm(true)} style={{ padding: '9px 12px', borderRadius: 8, background: 'none', border: '0.5px solid rgba(194,48,48,0.25)', color: 'var(--red)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                    🗑
                  </button>
                )}
              </div>

              {showDeleteConfirm && (
                <div style={{ background: 'var(--red-light)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>{t('goals_delete_confirm')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}><strong>{editName}</strong> {t('goals_delete_body')}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary" style={{ flex: 1 }}>{t('goals_keep')}</button>
                    <button onClick={handleDelete} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--red)', border: 'none', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{t('goals_delete_yes')}</button>
                  </div>
                </div>
              )}
              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}

      <Toast />
    </>
  )
}
