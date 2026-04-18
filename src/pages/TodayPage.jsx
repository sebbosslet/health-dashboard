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
  const [recoveryGoals, setRecoveryGoals] = useState([])
  const [funGoals, setFunGoals] = useState([])
  const [activeRecovery, setActiveRecovery] = useState(new Set())
  const [activeFun, setActiveFun] = useState(new Set())

  useEffect(() => {
    supabase
      .from('goals')
      .select('name, category, emoji')
      .eq('user_id', session.user.id)
      .in('category', ['Activity', 'Evening habits', 'Recovery & Self-care', 'Fun'])
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
        setRecoveryGoals((data || []).filter(g => g.category === 'Recovery & Self-care'))
        setFunGoals((data || []).filter(g => g.category === 'Fun'))
      })
  }, [session.user.id])

  const [activeActivity, setActiveActivity] = useState(new Set())
  const [nutritionExpanded, setNutritionExpanded] = useState(true)
  const [addingMeal, setAddingMeal] = useState(false)
  const [activeHabits, setActiveHabits] = useState(new Set())
  const [mealCalories, setMealCalories] = useState(0)
  const [water, setWater] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (log) {
      setActiveActivity(new Set(log.activity || []))
      setActiveHabits(new Set(log.habits || []))
      setActiveRecovery(new Set(log.activity || []))
      setActiveFun(new Set(log.activity || []))
      setWater(log.water ? String(log.water) : '0')
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

        {/* Recovery snapshot — quick at-a-glance before opening Sleep tab */}
        {log?.recovery_score || log?.sleep_duration ? (
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="card-title">
                {log.recovery_score >= 67 ? '🟢' : log.recovery_score >= 34 ? '🟡' : '🔴'} {lang === 'de' ? 'Erholung heute' : 'Recovery today'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>WHOOP</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { label: lang === 'de' ? 'Erholung' : 'Recovery', value: log.recovery_score ? Math.round(log.recovery_score) + '%' : '—', color: log.recovery_score >= 67 ? 'var(--green)' : log.recovery_score >= 34 ? 'var(--amber)' : 'var(--red)' },
                { label: 'HRV', value: log.hrv ? Math.round(log.hrv) + 'ms' : '—', color: 'var(--purple)' },
                { label: 'RHR', value: log.rhr ? Math.round(log.rhr) + 'bpm' : '—', color: 'var(--blue)' },
                { label: lang === 'de' ? 'Schlaf' : 'Sleep', value: log.sleep_duration ? (Math.floor(log.sleep_duration) + 'h' + (Math.round((log.sleep_duration % 1) * 60) > 0 ? Math.round((log.sleep_duration % 1) * 60) + 'm' : '')) : '—', color: 'var(--blue)' },
              ].map(m => (
                <div key={m.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                  <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginTop: 2 }}>{m.label}</div>
                </div>
              ))}
            </div>
            {(log.sleep_efficiency || log.sleep_restorative) && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--border)', fontSize: 11, color: 'var(--text2)' }}>
                {log.sleep_efficiency && <span>Efficiency <strong>{Math.round(log.sleep_efficiency)}%</strong></span>}
                {log.sleep_restorative && <span>Restorative <strong>{Math.floor(log.sleep_restorative)}h{Math.round((log.sleep_restorative % 1) * 60) > 0 ? Math.round((log.sleep_restorative % 1) * 60) + 'm' : ''}</strong></span>}
              </div>
            )}
          </div>
        ) : null}

        {/* Daily Intelligence — Check-in, Sleep, Insight */}
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
          <div className="card-header">
            <button onClick={() => setNutritionExpanded(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
              <span className="card-title">{t('today_nutrition')}</span>
              {!nutritionExpanded && mealCalories > 0 && (
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginLeft: 4 }}>
                  ✅ {mealCalories} kcal
                </span>
              )}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: nutritionExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', marginLeft: 2 }}><path d="M3 5l4 4 4-4" stroke="var(--text3)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {nutritionExpanded && (
              <button onClick={() => { /* trigger add in MealLogger via ref or state */ setAddingMeal(true) }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 16, background: 'var(--green)', border: 'none', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
                Add
              </button>
            )}
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
              <MealLogger session={session} date={today} dinnerTime={log?.dinner_time?.slice(0,5) || ''} onSave={save} onCaloriesUpdated={setMealCalories} onDoneEating={() => {}} addTriggered={addingMeal} onAddHandled={() => setAddingMeal(false)} />
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

        {/* Recovery & Self-care */}
        {recoveryGoals.length > 0 && (
          <div className="card">
            <div className="card-header"><span className="card-title">🧘 Recovery & Self-care</span></div>
            <div style={{ padding: '10px 14px 14px' }}>
              <div className="toggle-grid">
                {recoveryGoals.map(a => {
                  const key = a.name.toLowerCase().replace(/\s+/g, '_')
                  return (
                    <button key={key} className={`toggle-btn ${activeActivity.has(key) ? 'active' : ''}`} onClick={() => toggle(activeActivity, setActiveActivity, key)}>
                      {a.emoji || ''} {a.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Fun */}
        {funGoals.length > 0 && (
          <div className="card">
            <div className="card-header"><span className="card-title">🎉 Fun</span></div>
            <div style={{ padding: '10px 14px 14px' }}>
              <div className="toggle-grid">
                {funGoals.map(a => {
                  const key = a.name.toLowerCase().replace(/\s+/g, '_')
                  return (
                    <button key={key} className={`toggle-btn ${activeActivity.has(key) ? 'active' : ''}`} onClick={() => toggle(activeActivity, setActiveActivity, key)}>
                      {a.emoji || ''} {a.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

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
