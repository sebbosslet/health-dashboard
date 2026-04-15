import { useLang } from '../lib/LangContext'
import { useState, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useData'
import MonthlyReport from '../components/MonthlyReport'
import SleepHRAnalysis from '../components/SleepHRAnalysis'

function MiniBarChart({ data, color, height = 52 }) {
  if (!data || data.length === 0) return <div style={{ height, background: 'var(--surface2)', borderRadius: 4 }} />
  const max = Math.max(...data.map(d => d.value || 0), 1)
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3, height: '100%' }}>
          <div style={{ width: '100%', borderRadius: '2px 2px 0 0', background: d.value ? color : 'var(--surface2)', height: d.value ? `${Math.max(4, (d.value / max) * (height - 18))}px` : '4px', transition: 'height 0.3s ease' }} />
          <div style={{ fontSize: 9, color: 'var(--text3)' }}>{d.label}</div>
        </div>
      ))}
    </div>
  )
}

export default function TrendsPage({ session }) {
  const { t } = useLang()
  const [logs, setLogs] = useState([])
  const [period, setPeriod] = useState('7d')
  const [showReport, setShowReport] = useState(false)

  if (showReport) {
    return <MonthlyReport session={session} onClose={() => setShowReport(false)} />
  }
  const { settings } = useSettings(session.user.id)

  useEffect(() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const from = format(subDays(new Date(), days), 'yyyy-MM-dd')
    supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', session.user.id)
      .gte('date', from)
      .order('date', { ascending: true })
      .then(({ data }) => setLogs(data || []))
  }, [session.user.id, period])

  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const dateRange = Array.from({ length: Math.min(days, 14) }, (_, i) => {
    const d = subDays(new Date(), Math.min(days, 14) - 1 - i)
    return format(d, 'yyyy-MM-dd')
  })

  function getChartData(field, labelFormat = 'EEE') {
    return dateRange.map(date => {
      const log = logs.find(l => l.date === date)
      return { label: format(new Date(date), labelFormat), value: log?.[field] || 0 }
    })
  }

  const avgSleep = logs.filter(l => l.sleep_duration).length
    ? (logs.filter(l => l.sleep_duration).reduce((a, l) => a + l.sleep_duration, 0) / logs.filter(l => l.sleep_duration).length).toFixed(1)
    : null

  const avgRecovery = logs.filter(l => l.recovery_score).length
    ? Math.round(logs.filter(l => l.recovery_score).reduce((a, l) => a + l.recovery_score, 0) / logs.filter(l => l.recovery_score).length)
    : null

  const avgCalories = logs.filter(l => l.calories).length
    ? Math.round(logs.filter(l => l.calories).reduce((a, l) => a + l.calories, 0) / logs.filter(l => l.calories).length)
    : null

  const avgSteps = logs.filter(l => l.steps).length
    ? Math.round(logs.filter(l => l.steps).reduce((a, l) => a + l.steps, 0) / logs.filter(l => l.steps).length)
    : null

  const latestWeight = logs.filter(l => l.weight).slice(-1)[0]?.weight
  const earliestWeight = logs.filter(l => l.weight)[0]?.weight

  const habitKeys = ['gym', 'run', 'reading', 'meditation', 'nophone', 'journal']
  const habitLabels = { gym: 'Gym', run: 'Run', reading: 'Reading', meditation: 'Meditation', nophone: 'No phone', journal: 'Journaling' }
  const habitCounts = habitKeys.map(h => ({
    name: habitLabels[h],
    count: logs.filter(l => l.activity?.includes(h) || l.habits?.includes(h)).length,
    total: logs.length,
    pct: logs.length ? Math.round((logs.filter(l => l.activity?.includes(h) || l.habits?.includes(h)).length / logs.length) * 100) : 0,
  }))

  const periodBtns = ['7d', '30d', '90d']

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">{`${t('trends_title')}`}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {periodBtns.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: '5px 10px', borderRadius: 20, fontSize: 11, border: '0.5px solid var(--border)', background: period === p ? 'var(--green-light)' : 'var(--surface2)', color: period === p ? 'var(--green)' : 'var(--text2)', fontWeight: period === p ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="page-section">

        {/* Monthly report card */}
        <div className="card" onClick={() => setShowReport(true)} style={{ cursor: 'pointer' }}>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="2" width="14" height="16" rx="2" stroke="var(--green)" strokeWidth="1.3"/><path d="M7 7h6M7 10.5h5M7 14h3" stroke="var(--green)" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t('trends_monthly_report')}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{t('trends_report_sub')}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 3l6 5-6 5" stroke="var(--text2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>

        {/* Sleep */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Sleep duration</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>{avgSleep ? `avg ${avgSleep}h` : '—'}</span>
          </div>
          <div style={{ padding: '12px 14px 14px' }}>
            <MiniBarChart data={getChartData('sleep_duration')} color="var(--blue)" />
          </div>
        </div>

        {/* Recovery */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recovery · WHOOP</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{avgRecovery ? `avg ${avgRecovery}%` : '—'}</span>
          </div>
          <div style={{ padding: '12px 14px 14px' }}>
            <MiniBarChart data={getChartData('recovery_score')} color="var(--green)" />
          </div>
        </div>

        {/* HRV & RHR */}
        <div className="card">
          <div className="card-header"><span className="card-title">HRV &amp; RHR</span></div>
          <div className="metric-grid">
            <div className="metric-cell">
              <div className="metric-label">Avg HRV</div>
              <div className="metric-value" style={{ color: 'var(--purple)' }}>
                {logs.filter(l => l.hrv).length ? Math.round(logs.filter(l => l.hrv).reduce((a, l) => a + l.hrv, 0) / logs.filter(l => l.hrv).length) : '—'}
                <span className="metric-unit">{logs.filter(l => l.hrv).length ? 'ms' : ''}</span>
              </div>
            </div>
            <div className="metric-cell">
              <div className="metric-label">Avg RHR</div>
              <div className="metric-value">
                {logs.filter(l => l.rhr).length ? Math.round(logs.filter(l => l.rhr).reduce((a, l) => a + l.rhr, 0) / logs.filter(l => l.rhr).length) : '—'}
                <span className="metric-unit">{logs.filter(l => l.rhr).length ? 'bpm' : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Steps</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>{avgSteps ? `avg ${(avgSteps / 1000).toFixed(1)}k` : '—'}</span>
          </div>
          <div style={{ padding: '12px 14px 14px' }}>
            <MiniBarChart data={getChartData('steps')} color="var(--green)" />
          </div>
        </div>

        {/* Calories */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Calories vs target</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>{avgCalories ? `avg ${avgCalories.toLocaleString()}` : '—'}</span>
          </div>
          <div style={{ padding: '12px 14px 14px' }}>
            <MiniBarChart data={getChartData('calories')} color="var(--amber)" />
          </div>
        </div>

        {/* Weight */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Weight</span>
            {latestWeight && earliestWeight && (
              <span className="badge badge-green">{latestWeight < earliestWeight ? '−' : '+'}{Math.abs(latestWeight - earliestWeight).toFixed(1)} kg</span>
            )}
          </div>
          <div style={{ padding: '12px 14px' }}>
            {latestWeight ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{latestWeight.toFixed(1)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>goal {settings.target_weight || '—'} kg</span>
                </div>
                {settings.target_weight && settings.start_weight && (
                  <>
                    <div className="bar-wrap-lg">
                      <div className="bar bar-green" style={{ width: `${Math.min(100, Math.max(0, Math.round(((settings.start_weight - latestWeight) / (settings.start_weight - settings.target_weight)) * 100)))}%` }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 5 }}>
                      {(latestWeight - settings.target_weight).toFixed(1)} kg remaining · ~{Math.ceil((latestWeight - settings.target_weight) / 0.5)} weeks at 0.5 kg/week
                    </div>
                  </>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: '8px 0' }}>No weight data yet — sync from Apple Health in Profile</div>
            )}
          </div>
        </div>

        {/* Habit completion */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Habit completion</span>
            <span className="badge badge-gray">Last {period}</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {habitCounts.map(h => (
              <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ flex: 1, fontSize: 12 }}>{h.name}</div>
                <div style={{ width: 80, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 2, background: h.pct >= 70 ? 'var(--green)' : h.pct >= 40 ? 'var(--amber)' : 'var(--red)', width: `${h.pct}%` }} />
                </div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 32, textAlign: 'right', color: h.pct >= 70 ? 'var(--green)' : h.pct >= 40 ? 'var(--amber)' : 'var(--red)' }}>
                  {h.pct}%
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 8 }} />

        {/* Sleep HR Analysis */}
        <SleepHRAnalysis session={session} />

        <div style={{ height: 8 }} />
      </div>
    </>
  )
}
