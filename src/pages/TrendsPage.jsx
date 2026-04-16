import { useLang } from '../lib/LangContext'
import { useState, useEffect } from 'react'
import { format, subDays, startOfWeek, isMonday } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useData'
import MonthlyReport from '../components/MonthlyReport'
import SleepHRAnalysis from '../components/SleepHRAnalysis'

// ─── Chart components ─────────────────────────────────────────────────────────

function BarChart({ data, color, height = 52, target }) {
  if (!data?.length) return <div style={{ height, background: 'var(--surface2)', borderRadius: 4 }} />
  const values = data.map(d => d.value).filter(v => v !== null && v > 0)
  const max = Math.max(...values, target || 1, 1)
  return (
    <div style={{ position: 'relative' }}>
      {target && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          bottom: 18 + ((target / max) * (height - 18)),
          borderTop: '1px dashed rgba(0,0,0,0.15)', zIndex: 1,
        }} />
      )}
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3, height: '100%' }}>
            <div style={{
              width: '100%', borderRadius: '2px 2px 0 0',
              background: d.value ? color : 'var(--surface2)',
              height: d.value ? `${Math.max(4, (d.value / max) * (height - 18))}px` : '4px',
              transition: 'height 0.3s ease',
              opacity: d.today ? 1 : 0.85,
            }} />
            <div style={{ fontSize: 9, color: 'var(--text3)' }}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LineChart({ data, color, height = 52 }) {
function LineChart({ data, color, height = 52 }) {
  if (!data?.length) return <div style={{ height, background: 'var(--surface2)', borderRadius: 4 }} />
  const values = data.map(d => d.value).filter(Boolean)
  if (values.length < 1) return <div style={{ height, background: 'var(--surface2)', borderRadius: 4 }} />
  const min = Math.min(...values) * 0.97
  const max = Math.max(...values) * 1.03
  const range = max - min || 1
  const w = 100 / data.length

  const points = data.map((d, i) => ({
    x: i * w + w / 2,
    y: d.value ? 100 - ((d.value - min) / range) * 80 - 10 : null,
    index: i,
  }))

  // Build path with M (move) on gap, L (line) when consecutive
  let path = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.y === null) continue
    const prev = points.slice(0, i).reverse().find(q => q.y !== null)
    const isGap = !prev || (i - prev.index) > 1
    path += `${isGap ? 'M' : 'L'} ${p.x} ${p.y} `
  }

  const dotPoints = points.filter(p => p.y !== null)

  return (
    <div style={{ position: 'relative', height }}>
      <svg width="100%" height={height - 14} style={{ overflow: 'visible' }}>
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {dotPoints.map((p, i) => (
          <circle key={i} cx={`${p.x}%`} cy={p.y} r="2.5" fill={color} />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 2, position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--text3)' }}>{d.label}</div>
        ))}
      </div>
    </div>
  )
}

// ─── Weekly summary ───────────────────────────────────────────────────────────

function WeeklySummary({ logs, settings, lang }) {
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekLogs = logs.filter(l => l.date >= weekStart)
  if (!weekLogs.length) return null

  const avgRecovery = weekLogs.filter(l => l.recovery_score).length
    ? Math.round(weekLogs.filter(l => l.recovery_score).reduce((a, l) => a + l.recovery_score, 0) / weekLogs.filter(l => l.recovery_score).length) : null
  const avgSleep = weekLogs.filter(l => l.sleep_duration).length
    ? +(weekLogs.filter(l => l.sleep_duration).reduce((a, l) => a + l.sleep_duration, 0) / weekLogs.filter(l => l.sleep_duration).length).toFixed(1) : null
  const gymCount = weekLogs.filter(l => l.activity?.includes('gym')).length
  const runCount = weekLogs.filter(l => l.activity?.includes('run')).length

  const weightLogs = weekLogs.filter(l => l.weight)
  const weightChange = weightLogs.length >= 2
    ? +(weightLogs[weightLogs.length-1].weight - weightLogs[0].weight).toFixed(1) : null

  const habitTotal = weekLogs.reduce((a, l) => a + (l.habits?.length || 0), 0)
  const habitMax = weekLogs.length * 4
  const habitRate = habitMax > 0 ? Math.round((habitTotal / habitMax) * 100) : null

  const items = [
    avgRecovery && { icon: '⚡', label: lang === 'de' ? 'Erholung' : 'Recovery', value: `${avgRecovery}%`, color: avgRecovery >= 67 ? 'var(--green)' : 'var(--amber)' },
    avgSleep && { icon: '💤', label: lang === 'de' ? 'Schlaf' : 'Sleep', value: `${avgSleep}h`, color: 'var(--blue)' },
    gymCount > 0 && { icon: '🏋️', label: 'Gym', value: `${gymCount}×`, color: 'var(--green)' },
    runCount > 0 && { icon: '🏃', label: lang === 'de' ? 'Laufen' : 'Run', value: `${runCount}×`, color: 'var(--green)' },
    weightChange !== null && { icon: '⚖️', label: lang === 'de' ? 'Gewicht' : 'Weight', value: `${weightChange > 0 ? '+' : ''}${weightChange}kg`, color: weightChange < 0 ? 'var(--green)' : weightChange > 0.3 ? 'var(--red)' : 'var(--text2)' },
    habitRate !== null && { icon: '✅', label: lang === 'de' ? 'Gewohnheiten' : 'Habits', value: `${habitRate}%`, color: habitRate >= 70 ? 'var(--green)' : 'var(--amber)' },
  ].filter(Boolean)

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(26,122,94,0.06), rgba(26,122,94,0.02))', border: '0.5px solid var(--green-border)', borderRadius: 14, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        📅 {lang === 'de' ? 'Diese Woche' : 'This week'}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>{item.label}</span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: item.color }}>{item.value}</span>
          </div>
        ))}
      </div>
      {settings?.target_weight && weightChange !== null && weightChange > -0.3 && (
        <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>
          ⚠ {lang === 'de' ? `Gewichtsziel: -0,5kg/Woche. Diese Woche: ${weightChange > 0 ? '+' : ''}${weightChange}kg.` : `Weight target: -0.5kg/week. This week: ${weightChange > 0 ? '+' : ''}${weightChange}kg.`}
        </div>
      )}
    </div>
  )
}

// ─── Morning feel trend ───────────────────────────────────────────────────────

function MorningFeelChart({ data, lang }) {
  if (!data.some(d => d.energy || d.mood || d.soreness)) return null
  const days = data.slice(-14)

  return (
    <div style={{ padding: '10px 14px 14px' }}>
      <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 40, marginBottom: 6 }}>
        {days.map((d, i) => {
          const avg = [d.energy, d.mood].filter(Boolean)
          const val = avg.length ? avg.reduce((a, v) => a + v, 0) / avg.length : 0
          const color = val >= 4 ? 'var(--green)' : val >= 3 ? 'var(--amber)' : val > 0 ? 'var(--red)' : 'var(--surface2)'
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 2 }}>
              <div style={{ width: '100%', borderRadius: '2px 2px 0 0', background: color, height: val ? `${(val / 5) * 32}px` : '3px' }} />
              <div style={{ fontSize: 8, color: 'var(--text3)' }}>{format(new Date(d.date + 'T12:00'), 'EEE')[0]}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text3)' }}>
        <span>🟢 {lang === 'de' ? 'Gut (4-5)' : 'Good (4-5)'}</span>
        <span>🟡 {lang === 'de' ? 'OK (3)' : 'OK (3)'}</span>
        <span>🔴 {lang === 'de' ? 'Schlecht (1-2)' : 'Poor (1-2)'}</span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrendsPage({ session }) {
  const { t, lang } = useLang()
  const [logs, setLogs] = useState([])
  const [period, setPeriod] = useState('30d')
  const [showReport, setShowReport] = useState(false)
  const [showSleepHR, setShowSleepHR] = useState(false)
  const { settings } = useSettings(session.user.id)

  useEffect(() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const from = format(subDays(new Date(), days), 'yyyy-MM-dd')
    supabase.from('daily_logs').select('*').eq('user_id', session.user.id)
      .gte('date', from).order('date', { ascending: true })
      .then(({ data }) => setLogs(data || []))
  }, [session.user.id, period])

  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const chartDays = Math.min(days, 28)
  const dateRange = Array.from({ length: chartDays }, (_, i) => {
    const d = subDays(new Date(), chartDays - 1 - i)
    return format(d, 'yyyy-MM-dd')
  })

  function chartData(field, labelFmt = 'd') {
    return dateRange.map(date => {
      const log = logs.find(l => l.date === date)
      const val = log?.[field]
      return {
        label: format(new Date(date + 'T12:00'), labelFmt),
        value: val || null,
        today: date === format(new Date(), 'yyyy-MM-dd'),
      }
    })
  }

  const withSleep = logs.filter(l => l.sleep_duration)
  const withRecovery = logs.filter(l => l.recovery_score)
  const withHrv = logs.filter(l => l.hrv)
  const withRhr = logs.filter(l => l.rhr)
  const withSteps = logs.filter(l => l.steps)
  const withWeight = logs.filter(l => l.weight)
  const withCalories = logs.filter(l => l.calories)

  const avg = (arr, key) => arr.length ? +(arr.reduce((a, l) => a + l[key], 0) / arr.length).toFixed(1) : null
  const avgInt = (arr, key) => arr.length ? Math.round(arr.reduce((a, l) => a + l[key], 0) / arr.length) : null

  const avgSleep = avg(withSleep, 'sleep_duration')
  const avgRecovery = avgInt(withRecovery, 'recovery_score')
  const avgHrv = avg(withHrv, 'hrv')
  const avgRhr = avgInt(withRhr, 'rhr')
  const avgSteps = avgInt(withSteps, 'steps')
  const avgCalories = avgInt(withCalories, 'calories')
  const latestWeight = withWeight[withWeight.length - 1]?.weight
  const earliestWeight = withWeight[0]?.weight

  // Dynamic habits from logs
  const allActivityKeys = [...new Set(logs.flatMap(l => l.activity || []))]
  const allHabitKeys = [...new Set(logs.flatMap(l => l.habits || []))]
  const habitCounts = [...allActivityKeys, ...allHabitKeys].map(key => ({
    key,
    pct: Math.round((logs.filter(l => l.activity?.includes(key) || l.habits?.includes(key)).length / logs.length) * 100),
    count: logs.filter(l => l.activity?.includes(key) || l.habits?.includes(key)).length,
  })).filter(h => h.count > 0).sort((a, b) => b.pct - a.pct)

  // Morning feel data
  const feelData = dateRange.map(date => {
    const log = logs.find(l => l.date === date)
    return { date, energy: log?.morning_energy, mood: log?.morning_mood, soreness: log?.morning_soreness }
  })
  const hasFeel = feelData.some(d => d.energy || d.mood)

  if (showReport) return <MonthlyReport session={session} onClose={() => setShowReport(false)} />

  if (showSleepHR) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 0' }}>
        <button onClick={() => setShowSleepHR(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit', padding: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {lang === 'de' ? 'Zurück' : 'Back'}
        </button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>💓 Sleep HR Analysis</span>
      </div>
      <div style={{ padding: '12px' }}><SleepHRAnalysis session={session} /></div>
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">{t('trends_title')}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: '5px 10px', borderRadius: 20, fontSize: 11,
              border: '0.5px solid var(--border)',
              background: period === p ? 'var(--green-light)' : 'var(--surface2)',
              color: period === p ? 'var(--green)' : 'var(--text2)',
              fontWeight: period === p ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit'
            }}>{p}</button>
          ))}
        </div>
      </div>

      <div className="page-section">

        {/* Weekly summary */}
        <WeeklySummary logs={logs} settings={settings} lang={lang} />

        {/* Report + Sleep HR entry points */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { icon: '📄', label: t('trends_monthly_report'), sub: lang === 'de' ? 'KI · PDF' : 'AI · PDF', onClick: () => setShowReport(true), color: 'var(--green)' },
            { icon: '💓', label: 'Sleep HR', sub: lang === 'de' ? 'Schlafqualität' : 'Sleep quality', onClick: () => setShowSleepHR(true), color: 'var(--purple)' },
          ].map(c => (
            <div key={c.label} className="card" onClick={c.onClick} style={{ cursor: 'pointer' }}>
              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 24 }}>{c.icon}</span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>{c.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Sleep */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">💤 {lang === 'de' ? 'Schlaf' : 'Sleep'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>
              {avgSleep ? `⌀ ${avgSleep}h` : '—'}
            </span>
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            <BarChart data={chartData('sleep_duration')} color="var(--blue)" target={8} />
          </div>
        </div>

        {/* Recovery */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">⚡ {lang === 'de' ? 'Erholung' : 'Recovery'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
              {avgRecovery ? `⌀ ${avgRecovery}%` : '—'}
            </span>
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            <BarChart data={chartData('recovery_score')} color="var(--green)" target={67} />
          </div>
        </div>

        {/* HRV */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🫀 HRV</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)', fontFamily: 'var(--font-mono)' }}>
              {avgHrv ? `⌀ ${avgHrv}ms` : '—'}
            </span>
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            <LineChart data={chartData('hrv')} color="var(--purple)" />
          </div>
        </div>

        {/* RHR */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">❤️ {lang === 'de' ? 'Ruhepuls' : 'Resting HR'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {avgRhr ? `⌀ ${avgRhr} bpm` : '—'}
            </span>
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            <LineChart data={chartData('rhr')} color="var(--red)" />
          </div>
        </div>

        {/* Weight */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">⚖️ {lang === 'de' ? 'Gewicht' : 'Weight'}</span>
            {latestWeight && earliestWeight && latestWeight !== earliestWeight && (
              <span className="badge" style={{
                background: latestWeight < earliestWeight ? 'var(--green-light)' : 'rgba(194,48,48,0.1)',
                color: latestWeight < earliestWeight ? 'var(--green)' : 'var(--red)',
              }}>
                {latestWeight < earliestWeight ? '−' : '+'}{Math.abs(latestWeight - earliestWeight).toFixed(1)} kg
              </span>
            )}
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            {latestWeight ? (
              <>
                <LineChart data={chartData('weight')} color="var(--amber)" />
                {settings?.target_weight && (
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>
                    {(latestWeight - settings.target_weight).toFixed(1)} kg {lang === 'de' ? 'bis Ziel' : 'to goal'} · ~{Math.ceil((latestWeight - settings.target_weight) / 0.5)} {lang === 'de' ? 'Wochen' : 'weeks'}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: '8px 0' }}>
                {lang === 'de' ? 'Kein Gewicht — Apple Health verbinden' : 'No weight data — sync via Apple Health'}
              </div>
            )}
          </div>
        </div>

        {/* Steps */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">👟 {lang === 'de' ? 'Schritte' : 'Steps'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
              {avgSteps ? `⌀ ${(avgSteps/1000).toFixed(1)}k` : '—'}
            </span>
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            <BarChart data={chartData('steps')} color="var(--green)" target={settings?.steps_target || 10000} />
          </div>
        </div>

        {/* Calories */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🥗 {lang === 'de' ? 'Kalorien' : 'Calories'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
              {avgCalories ? `⌀ ${avgCalories.toLocaleString()}` : '—'}
            </span>
          </div>
          <div style={{ padding: '10px 14px 14px' }}>
            <BarChart data={chartData('calories')} color="var(--amber)" target={settings?.calorie_target || 1900} />
          </div>
        </div>

        {/* Morning feel */}
        {hasFeel && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">🌅 {lang === 'de' ? 'Morgen-Gefühl' : 'Morning feel'}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{lang === 'de' ? 'Energie + Stimmung' : 'energy + mood'}</span>
            </div>
            <MorningFeelChart data={feelData} lang={lang} />
          </div>
        )}

        {/* Habits */}
        {habitCounts.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">✅ {lang === 'de' ? 'Gewohnheiten' : 'Habits'}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{lang === 'de' ? `letzte ${period}` : `last ${period}`}</span>
            </div>
            <div style={{ padding: '4px 0' }}>
              {habitCounts.map(h => (
                <div key={h.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '0.5px solid var(--border)' }}>
                  <div style={{ flex: 1, fontSize: 12, textTransform: 'capitalize' }}>{h.key.replace(/_/g, ' ')}</div>
                  <div style={{ width: 80, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: h.pct >= 70 ? 'var(--green)' : h.pct >= 40 ? 'var(--amber)' : 'var(--red)', width: `${h.pct}%` }} />
                  </div>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 36, textAlign: 'right', color: h.pct >= 70 ? 'var(--green)' : h.pct >= 40 ? 'var(--amber)' : 'var(--red)' }}>
                    {h.pct}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>
    </>
  )
}
