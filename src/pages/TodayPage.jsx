import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useDailyLog, useSettings } from '../hooks/useData'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'
import { useLang } from '../lib/LangContext'
import MealLogger from '../components/MealLogger'
import PoopTracker from '../components/PoopTracker'
import DailyIntelligence, { EveningLog } from '../components/DailyIntelligence'
import { MedTracker, SupTracker } from '../components/MedSupTracker'
import { ProactiveNudges } from '../components/Briefing'
import DailyContext from '../components/DailyContext'

function fmtHours(h) {
  if (!h || h <= 0) return '—'
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}


// Emoji map for known activity/habit names
// ─── End of Day card: evening log + day context ───────────────────────────────

function EndOfDay({ session, log, onSave, habitGoals, activeHabits, onToggleHabit, today, lang }) {
  const [open, setOpen] = useState(false)
  const hasDone = !!(log?.phone_away_time || log?.wind_down || log?.habits?.length > 0)

  return (
    <div className="card">
      <div className="card-header" onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <span className="card-title">🌙 {lang === 'de' ? 'Tagesabschluss' : 'End of Day'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasDone && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.15s' }}>
            <path d="M2 4l4 4 4-4" stroke="var(--text3)" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      {open && (
        <>
          <EveningLog
            log={log}
            onSave={(fields) => onSave({ ...fields, habits: Array.from(activeHabits) })}
            lang={lang}
            habitGoals={habitGoals}
            activeHabits={activeHabits}
            onToggleHabit={onToggleHabit}
          />
          <div style={{ borderTop: '0.5px solid var(--border)' }}>
            <DailyContext session={session} date={today} />
          </div>
        </>
      )}
      {!open && hasDone && (
        <div style={{ padding: '6px 14px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {log.phone_away_time && <span style={{ fontSize: 11, color: 'var(--text2)' }}>📵 {log.phone_away_time.slice(0,5)}</span>}
          {log.dinner_time && <span style={{ fontSize: 11, color: 'var(--text2)' }}>🍽 {log.dinner_time.slice(0,5)}</span>}
          {log.wind_down && <span style={{ fontSize: 11, color: 'var(--text2)' }}>{log.wind_down === 'good' ? '😌' : log.wind_down === 'ok' ? '😐' : '😣'} {log.wind_down}</span>}
          {log.habits?.length > 0 && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {log.habits.length} {lang === 'de' ? 'Gewohnheiten' : 'habits'}</span>}
        </div>
      )}
    </div>
  )
}

export default function TodayPage({ session }) {
  const { t, lang } = useLang()
  const today = new Date()
  const { log, save, refetch } = useDailyLog(session.user.id, today)

  // Refetch when tab becomes visible (e.g. after Apple Health Shortcut runs)
  // Also poll every 60s in case tab was already open when Shortcut fired
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refetch() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(refetch, 60000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [refetch])
  const { settings } = useSettings(session.user.id)
  const [activityGoals, setActivityGoals] = useState([])
  const [habitGoals, setHabitGoals] = useState([])

  useEffect(() => {
    supabase
      .from('goals')
      .select('name, category, emoji')
      .eq('user_id', session.user.id)
      .in('category', ['Activity', 'Evening habits'])
      .then(({ data }) => {
        const activities = (data || []).filter(g => g.category === 'Activity')
        const habits = (data || []).filter(g => g.category === 'Evening habits')
        // Fall back to defaults if none defined
        setActivityGoals(activities.length ? activities : [
          { name: 'Gym' }, { name: 'Run' }, { name: 'Home workout' }, { name: 'Sauna' }
        ])
        setHabitGoals(habits.length ? habits : [
          { name: 'Reading' }, { name: 'Meditation' }, { name: 'No phone' }, { name: 'Journaling' }
        ])
      })
  }, [session.user.id])

  const [activeActivity, setActiveActivity] = useState(new Set())
  const [nutritionExpanded, setNutritionExpanded] = useState(true)
  const [activeHabits, setActiveHabits] = useState(new Set())
  const [mealCalories, setMealCalories] = useState(0)
  const [water, setWater] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (log) {
      setActiveActivity(new Set(log.activity || []))
      setActiveHabits(new Set(log.habits || []))
      setWater(log.water ? String(log.water) : '0')
      if (log.dinner_time) setNutritionExpanded(false)
    }
  }, [log])

  // Autosave calories when updated from MealLogger
  useEffect(() => {
    if (mealCalories > 0) save({ calories: mealCalories })
  }, [mealCalories])

  // Autosave water with 800ms debounce
  const waterRef = useRef(null)
  function updateWater(val) {
    setWater(val)
    clearTimeout(waterRef.current)
    waterRef.current = setTimeout(() => {
      save({ water: parseInt(val) || 0 })
    }, 800)
  }

  function toggle(set, setFn, key, type = 'activity') {
    setFn(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      // Autosave immediately
      const arr = Array.from(n)
      if (type === 'activity') save({ activity: arr })
      if (type === 'habit') save({ habits: arr })
      return n
    })
  }

  async function handleCloseDay() {
    setSaving(true)
    // Final sync of all state before closing
    await save({
      activity: Array.from(activeActivity),
      habits: Array.from(activeHabits),
      water: water ? parseInt(water) : null,
    })
    setSaving(false)
    showToast(lang === 'de' ? '✅ Tag abgeschlossen' : '✅ Day closed out')
  }

  const calorieTarget = settings.calorie_target || 1900
  const waterTarget = settings.water_target || 2500
  const stepsTarget = settings.steps_target || 10000
  const calPct = mealCalories ? Math.min(100, Math.round((mealCalories / calorieTarget) * 100)) : 0
  const waterPct = water ? Math.min(100, Math.round((parseInt(water) / waterTarget) * 100)) : 0
  const stepsPct = log?.steps ? Math.min(100, Math.round((log.steps / stepsTarget) * 100)) : 0

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">{t('today_title')}</div>
          <div className="page-header-sub">{format(today, 'EEEE, d MMMM')}</div>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>S</div>
      </div>

      <div className="page-section">

        {/* Proactive nudges */}
        <ProactiveNudges session={session} todayLog={log} settings={settings} />

        {/* 1. WHOOP Sleep */}
        {!!log?.sleep_duration && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">{t('today_sleep')}</span>
              <span className="source-pill source-whoop">WHOOP</span>
            </div>
            <div className="metric-grid">
              <div className="metric-cell">
                <div className="metric-label">{t('metric_duration')}</div>
                <div className="metric-value" style={{ color: 'var(--blue)' }}>{fmtHours(log.sleep_duration)}</div>
                <div className="bar-wrap"><div className="bar bar-blue" style={{ width: `${Math.min(100, (log.sleep_duration / 9) * 100)}%` }} /></div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">{t('metric_efficiency')}</div>
                <div className="metric-value" style={{ color: 'var(--green)' }}>{Math.round(log.sleep_efficiency || 0)}<span className="metric-unit">%</span></div>
                <div className="bar-wrap"><div className="bar bar-green" style={{ width: `${log.sleep_efficiency || 0}%` }} /></div>
              </div>
            </div>
          </div>
        )}

        {/* 2. WHOOP Recovery */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t('today_recovery')}</span>
            <span className="badge" style={{ background: 'rgba(194,48,48,0.08)', color: '#8b1f1f' }}>{t('today_auto_sync')}</span>
          </div>
          {log?.recovery_score ? (
            <div className="metric-grid">
              <div className="metric-cell">
                <div className="metric-label">{t('metric_recovery')}</div>
                <div className="metric-value" style={{ color: log.recovery_score >= 67 ? 'var(--green)' : log.recovery_score >= 34 ? 'var(--amber)' : 'var(--red)' }}>
                  {Math.round(log.recovery_score)}<span className="metric-unit">%</span>
                </div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">{t('metric_hrv')}</div>
                <div className="metric-value" style={{ color: 'var(--purple)' }}>{Math.round(log.hrv || 0)}<span className="metric-unit">ms</span></div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">{t('metric_rhr')}</div>
                <div className="metric-value">{Math.round(log.rhr || 0)}<span className="metric-unit">bpm</span></div>
              </div>
              <div className="metric-cell">
                <div className="metric-label">{t('metric_restorative')}</div>
                <div className="metric-value" style={{ color: 'var(--purple)' }}>{fmtHours(log.sleep_restorative)}</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '16px 14px', color: 'var(--text2)', fontSize: 13, textAlign: 'center' }}>
              {t('today_no_whoop')}
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text3)' }}>{t('today_no_whoop_sub')}</div>
            </div>
          )}
        </div>

        {/* 3. Daily Intelligence — WHOOP upload, morning check-in, insight */}
        <DailyIntelligence
          session={session}
          log={log}
          onSave={save}
          habitGoals={habitGoals}
          activeHabits={activeHabits}
          onToggleHabit={(key) => toggle(activeHabits, setActiveHabits, key, 'habit')}
        />

        {/* 4. Medications */}
        <MedTracker session={session} date={today} />

        {/* 5. Nutrition */}
        <div className="card">
          <div className="card-header" onClick={() => setNutritionExpanded(v => !v)} style={{ cursor: 'pointer' }}>
            <span className="card-title">{t('today_nutrition')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!nutritionExpanded && mealCalories > 0 && (
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                  ✅ {mealCalories} kcal
                </span>
              )}
              {nutritionExpanded
                ? <span className="badge badge-green">{t('today_ai_photo')}</span>
                : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="var(--text3)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              }
            </div>
          </div>

          <div style={{ display: nutritionExpanded ? 'block' : 'none' }}>
              <div style={{ padding: '10px 14px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 5 }}>
                  <span>{t('metric_calories')}</span>
                  <span style={{ fontWeight: 600, color: mealCalories > calorieTarget ? 'var(--red)' : 'var(--amber)' }}>
                    {mealCalories.toLocaleString()} / {calorieTarget.toLocaleString()} kcal
                  </span>
                </div>
                <div className="bar-wrap-lg">
                  <div className="bar" style={{ width: `${calPct}%`, background: mealCalories > calorieTarget ? 'var(--red)' : 'var(--amber)' }} />
                </div>
              </div>
              <MealLogger session={session} date={today} onCaloriesUpdated={setMealCalories} onDoneEating={() => setNutritionExpanded(false)} />
            </div>
        </div>

        {/* 5b. Hydration */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">💧 {lang === 'de' ? 'Hydration' : 'Hydration'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: parseInt(water) >= waterTarget ? 'var(--green)' : 'var(--blue)' }}>
              {water || 0} / {waterTarget} ml
            </span>
          </div>
          <div style={{ padding: '10px 14px 12px' }}>
            <div className="bar-wrap-lg" style={{ marginBottom: 10 }}>
              <div className="bar bar-blue" style={{ width: `${waterPct}%` }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[{ label: '1L 🫙', ml: 1000 }, { label: '750ml 🫙', ml: 750 }, { label: '500ml 🫙', ml: 500 }, { label: '250ml 🥛', ml: 250 }].map(btn => (
                <button key={btn.ml} onClick={() => updateWater(String((parseInt(water) || 0) + btn.ml))} style={{ flex: 1, minWidth: 60, padding: '8px 4px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + {btn.label}
                </button>
              ))}
              {parseInt(water) > 0 && (
                <button onClick={() => updateWater('0')} style={{ padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>↺</button>
              )}
            </div>
          </div>
        </div>

        {/* 6. Steps */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t('today_steps')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="source-pill source-apple">Apple Health</span>
              <button onClick={refetch} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0, lineHeight: 1, fontSize: 15 }}>↻</button>
            </div>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                  {log?.steps ? log.steps.toLocaleString() : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{t('today_steps_goal')} {stepsTarget.toLocaleString()}</div>
              </div>
              {!!log?.steps && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: stepsPct >= 100 ? 'var(--green)' : 'var(--text2)' }}>{stepsPct}%</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {stepsPct >= 100 ? t('today_steps_reached') : `${(stepsTarget - log.steps).toLocaleString()} ${t('today_steps_to_go')}`}
                  </div>
                </div>
              )}
            </div>
            <div className="bar-wrap-lg"><div className="bar bar-green" style={{ width: `${stepsPct}%` }} /></div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5 }}>{t('today_steps_auto')}</div>
          </div>
        </div>

        {/* 7. Bowel log */}
        <PoopTracker session={session} date={today} />

        {/* 8. Activity */}
        <div className="card">
          <div className="card-header"><span className="card-title">{t('today_activity')}</span></div>
          <div style={{ padding: '10px 14px 14px' }}>
            <div className="toggle-grid">
              {activityGoals.map(a => {
                const key = a.name.toLowerCase().replace(/\s+/g, '_')
                const emoji = a.emoji || ''
                return (
                  <button key={key} className={`toggle-btn ${activeActivity.has(key) ? 'active' : ''}`} onClick={() => toggle(activeActivity, setActiveActivity, key)}>
                    {emoji} {a.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* 9. Supplements */}
        <SupTracker session={session} date={today} />

        {/* 9. End of Day — evening log + day context */}
        <EndOfDay
          session={session}
          log={log}
          onSave={save}
          habitGoals={habitGoals}
          activeHabits={activeHabits}
          onToggleHabit={(key) => toggle(activeHabits, setActiveHabits, key, 'habit')}
          today={today}
          lang={lang}
        />

        <button className="btn-primary" onClick={handleCloseDay} disabled={saving}>
          {saving ? (lang === 'de' ? 'Speichern...' : 'Saving...') : (lang === 'de' ? '🌙 Tag abschließen' : '🌙 Close out today')}
        </button>
        <div style={{ height: 8 }} />
      </div>
      <Toast />
    </>
  )
}
