import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'

const TIMEFRAMES = [
  { key: 'day', label: 'Day', example: 'daily' },
  { key: 'week', label: 'Week', example: 'weekly' },
  { key: 'month', label: 'Month', example: 'monthly' },
  { key: 'quarter', label: 'Quarter', example: '90 days' },
  { key: 'year', label: 'Year', example: 'yearly' },
]

const CATEGORIES = ['Nutrition', 'Activity', 'Evening habits', 'Sleep', 'Custom']

const DEFAULT_GOALS = [
  { name: 'Daily calories', category: 'Nutrition', target_value: 1900, timeframe: 'day', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Daily water', category: 'Nutrition', target_value: 2500, timeframe: 'day', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Target weight', category: 'Nutrition', target_value: 70, timeframe: 'year', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Gym sessions', category: 'Activity', target_value: 3, timeframe: 'week', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Run', category: 'Activity', target_value: 2, timeframe: 'week', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Sauna', category: 'Activity', target_value: 2, timeframe: 'week', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Reading', category: 'Evening habits', target_value: 7, timeframe: 'week', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Meditation', category: 'Evening habits', target_value: 5, timeframe: 'week', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Journaling', category: 'Evening habits', target_value: 3, timeframe: 'week', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Sleep duration', category: 'Sleep', target_value: 8, timeframe: 'day', effective_from: format(new Date(), 'yyyy-MM-dd') },
  { name: 'Recovery score', category: 'Sleep', target_value: 67, timeframe: 'day', effective_from: format(new Date(), 'yyyy-MM-dd') },
]

function GoalRow({ goal, onEdit }) {
  return (
    <div onClick={() => onEdit(goal)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid var(--border)', cursor: 'pointer' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{goal.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>Effective {format(new Date(goal.effective_from), 'd MMM yyyy')}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>{goal.target_value}</div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>per {goal.timeframe}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </div>
  )
}

export default function GoalsPage({ session }) {
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [isNew, setIsNew] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('Activity')
  const [editValue, setEditValue] = useState('')
  const [editTimeframe, setEditTimeframe] = useState('week')
  const [editEffective, setEditEffective] = useState(format(new Date(), 'yyyy-MM-dd'))

  async function fetchGoals() {
    const { data } = await supabase.from('goals').select('*').eq('user_id', session.user.id).order('category').order('name')
    setGoals(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchGoals() }, [session.user.id])

  function openEdit(goal) {
    setEditing(goal)
    setIsNew(false)
    setEditName(goal.name)
    setEditCategory(goal.category)
    setEditValue(String(goal.target_value))
    setEditTimeframe(goal.timeframe)
    setEditEffective(goal.effective_from)
    setShowDeleteConfirm(false)
  }

  function openNew() {
    setEditing({ id: null })
    setIsNew(true)
    setEditName('')
    setEditCategory('Activity')
    setEditValue('')
    setEditTimeframe('week')
    setEditEffective(format(new Date(), 'yyyy-MM-dd'))
    setShowDeleteConfirm(false)
  }

  async function handleSave() {
    const payload = {
      user_id: session.user.id,
      name: editName,
      category: editCategory,
      target_value: parseFloat(editValue),
      timeframe: editTimeframe,
      effective_from: editEffective,
    }
    if (isNew) {
      const { error } = await supabase.from('goals').insert(payload)
      if (!error) { showToast('Goal added'); fetchGoals(); setEditing(null) }
    } else {
      const { error } = await supabase.from('goals').update(payload).eq('id', editing.id)
      if (!error) { showToast('Goal saved'); fetchGoals(); setEditing(null) }
    }
  }

  async function handleDelete() {
    const { error } = await supabase.from('goals').delete().eq('id', editing.id)
    if (!error) { showToast('Goal deleted'); fetchGoals(); setEditing(null) }
  }

  async function seedDefaultGoals() {
    const rows = DEFAULT_GOALS.map(g => ({ ...g, user_id: session.user.id }))
    await supabase.from('goals').insert(rows)
    fetchGoals()
    showToast('Default goals added')
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const catGoals = goals.filter(g => g.category === cat)
    if (catGoals.length) acc[cat] = catGoals
    return acc
  }, {})

  const summaryText = `${editValue || '—'} times per ${editTimeframe}`

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">Goals</div>
        <button onClick={openNew} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 20, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          + New goal
        </button>
      </div>

      <div className="page-section">
        {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)' }}>Loading...</div>}

        {!loading && goals.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 16 }}>No goals set yet</div>
            <button className="btn-primary" onClick={seedDefaultGoals}>Load default goals</button>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'center', padding: '4px 0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke="var(--text2)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Tap any goal to edit
        </div>

        {Object.entries(grouped).map(([cat, catGoals]) => (
          <div key={cat} className="card">
            <div className="card-header">
              <span className="card-title">{cat}</span>
            </div>
            {catGoals.map((g, i) => (
              <GoalRow key={g.id} goal={g} onEdit={openEdit} />
            ))}
          </div>
        ))}

        <div style={{ height: 8 }} />
      </div>

      {/* Edit / New sheet */}
      {editing && !showDeleteConfirm && (
        <div className="sheet-overlay" onClick={() => setEditing(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{isNew ? 'New goal' : `Edit · ${editing.name}`}</div>
            <div className="sheet-divider" />

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {isNew && (
                <div className="field">
                  <label className="field-label">Category</label>
                  <select className="field-input" value={editCategory} onChange={e => setEditCategory(e.target.value)}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}

              <div className="field">
                <label className="field-label">Goal name</label>
                <input className="field-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder="e.g. Gym sessions" />
              </div>

              <div className="field">
                <label className="field-label">Target number</label>
                <input className="field-input" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }} type="number" value={editValue} onChange={e => setEditValue(e.target.value)} placeholder="3" inputMode="decimal" />
              </div>

              <div className="field">
                <label className="field-label">Per</label>
                <div className="timeframe-grid">
                  {TIMEFRAMES.map(t => (
                    <button key={t.key} className={`tf-btn ${editTimeframe === t.key ? 'active' : ''}`} onClick={() => setEditTimeframe(t.key)}>
                      <span>{t.label}</span>
                      <span className="tf-example">{t.example}</span>
                    </button>
                  ))}
                </div>
              </div>

              {editValue && (
                <div className="summary-pill">
                  <span className="sp-label">Reads as</span>
                  <span className="sp-val">{summaryText}</span>
                </div>
              )}

              <div className="effective-date-box">
                <div className="edb-icon">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1.5" stroke="var(--blue)" strokeWidth="1.1"/><path d="M4 1v2M10 1v2M1 6h12" stroke="var(--blue)" strokeWidth="1.1"/></svg>
                </div>
                <div className="edb-info">
                  <div className="edb-label">Effective from</div>
                  <div className="edb-sub">Historical data uses previous target</div>
                </div>
                <input type="date" value={editEffective} onChange={e => setEditEffective(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--blue)', background: 'none', border: 'none', outline: 'none', cursor: 'pointer' }} />
              </div>

              <div className="btn-row" style={{ padding: 0 }}>
                <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-primary" onClick={handleSave} style={{ flex: 1 }}>Save changes</button>
              </div>

              {!isNew && (
                <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.5A1 1 0 004.7 12.5h4.6a1 1 0 001-.9L11 4" stroke="var(--red)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Delete this goal
                </button>
              )}

              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="sheet-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, width: 'calc(100% - 48px)', maxWidth: 340, padding: 24, margin: '0 auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--red-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M8 6V4h4v2M8.5 9.5v5M11.5 9.5v5M4 6l1 10a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0015 16l1-10" stroke="var(--red)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>Delete this goal?</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', lineHeight: 1.55, marginBottom: 20 }}>
              <strong style={{ color: 'var(--text)' }}>{editing?.name}</strong> will be removed. Your past logged data won't be affected.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn-danger" onClick={handleDelete} style={{ background: 'var(--red)', color: 'white' }}>Yes, delete goal</button>
              <button className="btn-secondary" style={{ width: '100%', textAlign: 'center' }} onClick={() => setShowDeleteConfirm(false)}>Keep it</button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </>
  )
}
