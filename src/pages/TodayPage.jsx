import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useDailyLog, useSettings } from '../hooks/useData'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'
import { useLang } from '../lib/LangContext'
import MealLogger from '../components/MealLogger'
import DailyIntelligence from '../components/DailyIntelligence'
import MedSupTracker from '../components/MedSupTracker'
import { MorningBriefing, ProactiveNudges } from '../components/Briefing'
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
const EMOJI_MAP = {
  gym: '🏋️', run: '🏃', home: '🤸', sauna: '🧖', swim: '🏊', bike: '🚴', walk: '🚶', yoga: '🧘',
  reading: '📚', meditation: '🧘', nophone: '📵', journal: '✍️', sleep: '😴', stretch: '🙆',
  cold: '🧊', gratitude: '🙏', vitamins: '💊', water: '💧',
}

function getEmoji(name) {
  const lower = name.toLowerCase().replace(/\s/g, '')
  for (const [key, emoji] of Object.entries(EMOJI_MAP)) {
    if (lower.includes(key)) return emoji
  }
  return '•'
}

export default function TodayPage({ session }) {
  const { t } = useLang()
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
      .select('name, category')
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
  const [activeHabits, setActiveHabits] = useState(new Set())
  const [mealCalories, setMealCalories] = useState(0)
  const [water, setWater] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (log) {
      setActiveActivity(new Set(log.activity || []))
      setActiveHabits(new Set(log.habits || []))
      setWater(log.water ? String(log.water) : '0')
    }
  }, [log])

  // When meal calories update from MealLogger, auto-save to daily log
  useEffect(() => {
    if (mealCalories > 0) {
      save({ calories: mealCalories })
    }
  }, [mealCalories])

  function toggle(set, setFn, key) {
    setFn(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await save({
      activity: Array.from(activeActivity),
      habits: Array.from(activeHabits),
      water: water ? parseInt(water) : null,
    })
    setSaving(false)
    showToast(error ? t('today_error') : t('today_saved'))
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

        {/* Proactive nudges - contextual, time-aware */}
        <ProactiveNudges session={session} todayLog={log} settings={settings} />

        {/* WHOOP Recovery */}
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

        {/* Sleep */}
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

        {/* Steps */}
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

        {/* Nutrition - now powered by MealLogger */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t('today_nutrition')}</span>
            <span className="badge badge-green">{t('today_ai_photo')}</span>
          </div>

          {/* Calorie progress bar */}
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

          {/* MealLogger component */}
          <MealLogger
            session={session}
            date={today}
            onCaloriesUpdated={setMealCalories}
          />

          {/* Water tracker */}
          <div style={{ padding: '10px 14px 12px', borderTop: '0.5px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{t('metric_water')}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: parseInt(water) >= waterTarget ? 'var(--green)' : 'var(--blue)' }}>
                {water || 0} / {waterTarget} ml
              </span>
            </div>
            <div className="bar-wrap" style={{ marginBottom: 10 }}>
              <div className="bar bar-blue" style={{ width: `${waterPct}%` }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: '1L 🫙', ml: 1000 },
                { label: '750ml 🫙', ml: 750 },
                { label: '500ml 🫙', ml: 500 },
                { label: '250ml 🥛', ml: 250 },
              ].map(btn => (
                <button key={btn.ml} onClick={() => setWater(w => String((parseInt(w) || 0) + btn.ml))} style={{ flex: 1, minWidth: 60, padding: '8px 4px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  + {btn.label}
                </button>
              ))}
              {parseInt(water) > 0 && (
                <button onClick={() => setWater('0')} style={{ padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ↺
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="card">
          <div className="card-header"><span className="card-title">{t('today_activity')}</span></div>
          <div style={{ padding: '10px 14px 14px' }}>
            <div className="toggle-grid">
              {activityGoals.map(a => {
                const key = a.name.toLowerCase().replace(/\s+/g, '_')
                return (
                  <button key={key} className={`toggle-btn ${activeActivity.has(key) ? 'active' : ''}`} onClick={() => toggle(activeActivity, setActiveActivity, key)}>
                    {getEmoji(a.name)} {a.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Day context - travel, stress, special events */}
        <DailyContext session={session} date={today} />

        {/* Medications & Supplements */}
        <MedSupTracker session={session} date={today} />

        {/* Daily Intelligence — end of day: evening log + morning check-in + insight */}
        <DailyIntelligence
          session={session}
          log={log}
          onSave={save}
          habitGoals={habitGoals}
          activeHabits={activeHabits}
          onToggleHabit={(key) => toggle(activeHabits, setActiveHabits, key)}
        />

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t('today_saving') : t('today_save')}
        </button>
        <div style={{ height: 8 }} />
      </div>
      <Toast />
    </>
  )
}
