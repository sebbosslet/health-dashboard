import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useDailyLog, useSettings } from '../hooks/useData'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'

const SUPPLEMENTS = [
  { key: 'thyroid', label: 'Thyroid 100mcg', cls: 'thyroid' },
  { key: 'magpill', label: 'Magnesium pill' },
  { key: 'magdrink', label: 'Magnesium drink' },
  { key: 'multi', label: 'Multivitamin' },
  { key: 'zinc', label: 'Zinc' },
  { key: 'iron', label: 'Iron' },
  { key: 'vitb', label: 'Vitamin B' },
  { key: 'vitd', label: 'Vitamin D' },
  { key: 'calnat', label: 'Calcium/Natrium' },
]

const ACTIVITIES = [
  { key: 'gym', label: 'Gym' },
  { key: 'run', label: 'Run' },
  { key: 'home', label: 'Home workout' },
  { key: 'sauna', label: 'Sauna' },
]

const HABITS = [
  { key: 'reading', label: 'Reading' },
  { key: 'meditation', label: 'Meditation' },
  { key: 'nophone', label: 'No phone' },
  { key: 'journal', label: 'Journaling' },
]

export default function TodayPage({ session }) {
  const today = new Date()
  const { log, save } = useDailyLog(session.user.id, today)
  const { settings } = useSettings(session.user.id)

  const [activeActivity, setActiveActivity] = useState(new Set())
  const [activeHabits, setActiveHabits] = useState(new Set())
  const [activeSupps, setActiveSupps] = useState(new Set(['thyroid']))
  const [calories, setCalories] = useState('')
  const [water, setWater] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (log) {
      setActiveActivity(new Set(log.activity || []))
      setActiveHabits(new Set(log.habits || []))
      setActiveSupps(new Set(log.supplements?.length ? log.supplements : ['thyroid']))
      setCalories(log.calories || '')
      setWater(log.water || '')
    }
  }, [log])

  function toggle(set, setFn, key) {
    setFn(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await save({
      activity: Array.from(activeActivity),
      habits: Array.from(activeHabits),
      supplements: Array.from(activeSupps),
      calories: calories ? parseInt(calories) : null,
      water: water ? parseInt(water) : null,
    })
    setSaving(false)
    if (!error) showToast('Saved!')
    else showToast('Error saving')
  }

  const calorieTarget = settings.calorie_target || 1900
  const waterTarget = settings.water_target || 2500
  const stepsTarget = settings.steps_target || 10000
  const calPct = calories ? Math.min(100, Math.round((parseInt(calories) / calorieTarget) * 100)) : 0
  const waterPct = water ? Math.min(100, Math.round((parseInt(water) / waterTarget) * 100)) : 0
  const stepsPct = log?.steps ? Math.min(100, Math.round((log.steps / stepsTarget) * 100)) : 0

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">Today</div>
          <div className="page-header-sub">{format(today, 'EEEE, d MMMM')}</div>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>
          S
        </div>
      </div>

      <div className="page-section">

        {/* WHOOP Recovery */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recovery · WHOOP</span>
            <span className="badge badge-red" style={{ background: 'rgba(194,48,48,0.08)', color: '#8b1f1f' }}>Auto sync</span>
          </div>
          {log?.recovery_score ? (
            <div className="metric-grid">
              <div className="metric-cell">
                <div className="metric-label">Recovery</div>
                <div className="metric-value" style={{ color: log.recovery_score >= 67 ? 'var(--green)' : log.recovery_score >= 34 ? 'var(--amber)' : 'var(--red)' }}>
                  {Math.round(log.recovery_score)}<span className="metric-unit">%</span>
                </div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">HRV</div>
                <div className="metric-value" style={{ color: 'var(--purple)' }}>
                  {Math.round(log.hrv || 0)}<span className="metric-unit">ms</span>
                </div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">RHR</div>
                <div className="metric-value">{Math.round(log.rhr || 0)}<span className="metric-unit">bpm</span></div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">Restorative</div>
                <div className="metric-value" style={{ color: 'var(--purple)' }}>
                  {(log.sleep_restorative || 0).toFixed(1)}<span className="metric-unit">h</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '16px 14px', color: 'var(--text2)', fontSize: 13, textAlign: 'center' }}>
              No WHOOP data yet today
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text3)' }}>Sync via Profile tab to connect WHOOP</div>
            </div>
          )}
        </div>

        {/* Sleep */}
        {log?.sleep_duration && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Sleep · WHOOP</span>
              <span className="source-pill source-whoop">WHOOP</span>
            </div>
            <div className="metric-grid">
              <div className="metric-cell">
                <div className="metric-label">Duration</div>
                <div className="metric-value" style={{ color: 'var(--blue)' }}>
                  {(log.sleep_duration || 0).toFixed(1)}<span className="metric-unit">h</span>
                </div>
                <div className="bar-wrap"><div className="bar bar-blue" style={{ width: `${Math.min(100, (log.sleep_duration / 9) * 100)}%` }} /></div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">Efficiency</div>
                <div className="metric-value" style={{ color: 'var(--green)' }}>
                  {Math.round(log.sleep_efficiency || 0)}<span className="metric-unit">%</span>
                </div>
                <div className="bar-wrap"><div className="bar bar-green" style={{ width: `${log.sleep_efficiency || 0}%` }} /></div>
              </div>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Steps today</span>
            <span className="source-pill source-apple">Apple Health</span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                  {log?.steps ? log.steps.toLocaleString() : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                  goal {stepsTarget.toLocaleString()}
                </div>
              </div>
              {log?.steps && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: stepsPct >= 100 ? 'var(--green)' : 'var(--text2)' }}>
                    {stepsPct}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {stepsPct >= 100 ? 'goal reached!' : `${(stepsTarget - log.steps).toLocaleString()} to go`}
                  </div>
                </div>
              )}
            </div>
            <div className="bar-wrap-lg">
              <div className="bar bar-green" style={{ width: `${stepsPct}%` }} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 8l2-3 2 1.5L7.5 2 9 4" stroke="var(--text3)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Syncs automatically via Apple Health Shortcut
            </div>
          </div>
        </div>

        {/* Nutrition */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Nutrition</span>
            <span className="badge badge-green">AI photo log</span>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}>
                <span>Calories</span>
                <span style={{ fontWeight: 600, color: 'var(--amber)' }}>
                  {calories || 0} / {calorieTarget.toLocaleString()} kcal
                </span>
              </div>
              <div className="bar-wrap-lg"><div className="bar bar-amber" style={{ width: `${calPct}%` }} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="field">
                <label className="field-label">Calories (kcal)</label>
                <input className="field-input" type="number" value={calories} onChange={e => setCalories(e.target.value)} placeholder={calorieTarget} inputMode="numeric" />
              </div>
              <div className="field">
                <label className="field-label">Water (ml)</label>
                <input className="field-input" type="number" value={water} onChange={e => setWater(e.target.value)} placeholder={waterTarget} inputMode="numeric" />
              </div>
            </div>
            {water && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}>
                  <span>Water</span>
                  <span style={{ fontWeight: 600, color: 'var(--blue)' }}>{waterPct}% of goal</span>
                </div>
                <div className="bar-wrap"><div className="bar bar-blue" style={{ width: `${waterPct}%` }} /></div>
              </div>
            )}
          </div>
        </div>

        {/* Activity */}
        <div className="card">
          <div className="card-header"><span className="card-title">Activity</span></div>
          <div style={{ padding: '10px 14px 14px' }}>
            <div className="toggle-grid">
              {ACTIVITIES.map(a => (
                <button key={a.key} className={`toggle-btn ${activeActivity.has(a.key) ? 'active' : ''}`} onClick={() => toggle(activeActivity, setActiveActivity, a.key)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Evening habits */}
        <div className="card">
          <div className="card-header"><span className="card-title">Evening habits</span></div>
          <div style={{ padding: '10px 14px 14px' }}>
            <div className="toggle-grid">
              {HABITS.map(h => (
                <button key={h.key} className={`toggle-btn ${activeHabits.has(h.key) ? 'active' : ''}`} onClick={() => toggle(activeHabits, setActiveHabits, h.key)}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Supplements */}
        <div className="card">
          <div className="card-header"><span className="card-title">Supplements</span></div>
          <div style={{ padding: '10px 14px 14px' }}>
            <div className="supp-grid">
              {SUPPLEMENTS.map(s => (
                <button key={s.key} className={`supp-pill ${s.cls || ''} ${activeSupps.has(s.key) ? 'active' : ''}`} onClick={() => toggle(activeSupps, setActiveSupps, s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Save button */}
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save today\'s log'}
        </button>

        <div style={{ height: 8 }} />
      </div>

      <Toast />
    </>
  )
}
