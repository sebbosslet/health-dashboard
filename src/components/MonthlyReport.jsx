import { useState, useEffect } from 'react'
import { format, startOfMonth, endOfMonth, subMonths, getDaysInMonth } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { useSettings } from '../hooks/useData'

function fmtHours(h) {
  if (!h || h <= 0) return '—'
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

async function generateMonthlyAISummary(data, lang, monthName) {
  const prompt = lang === 'de'
    ? `Du bist ein persönlicher Gesundheitscoach. Analysiere diese Monatsdaten und schreibe eine ehrliche, aufmunternde Zusammenfassung auf Deutsch.

Monat: ${monthName}
Schlaf: Durchschnitt ${data.avgSleep}h, beste Nacht ${data.bestSleep}h
Erholung: Durchschnitt ${data.avgRecovery}%, beste ${data.bestRecovery}%
HRV: Durchschnitt ${data.avgHrv}ms
Ruhepuls: Durchschnitt ${data.avgRhr} bpm
Schritte: Durchschnitt ${data.avgSteps}/Tag
Gewichtsveränderung: ${data.weightChange !== null ? data.weightChange + 'kg' : 'keine Daten'}
Aktivitäten: ${data.totalGym} Gym, ${data.totalRun} Läufe, ${data.totalSauna} Sauna
Habiterfüllung: ${data.habitRate}%
Tage mit Daten: ${data.daysLogged} von ${data.daysInMonth}

Schreibe 3 kurze Absätze: 1. Highlights des Monats 2. Bereiche zur Verbesserung 3. Empfehlungen für nächsten Monat. Sei direkt und konkret, nicht zu formell.`
    : `You are a personal health coach. Analyse this monthly data and write an honest, encouraging summary.

Month: ${monthName}
Sleep: avg ${data.avgSleep}h, best night ${data.bestSleep}h
Recovery: avg ${data.avgRecovery}%, best ${data.bestRecovery}%
HRV: avg ${data.avgHrv}ms
Resting HR: avg ${data.avgRhr} bpm
Steps: avg ${data.avgSteps}/day
Weight change: ${data.weightChange !== null ? data.weightChange + 'kg' : 'no data'}
Activities: ${data.totalGym} gym sessions, ${data.totalRun} runs, ${data.totalSauna} sauna
Habit completion: ${data.habitRate}%
Days with data: ${data.daysLogged} of ${data.daysInMonth}

Write 3 short paragraphs: 1. Month highlights 2. Areas to improve 3. Recommendations for next month. Be direct and specific, not overly formal.`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const result = await res.json()
  return result.content?.[0]?.text || ''
}

export default function MonthlyReport({ session, onClose }) {
  const { lang } = useLang()
  const { settings } = useSettings(session.user.id)
  const [selectedMonth, setSelectedMonth] = useState(() => subMonths(new Date(), 1))
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [aiSummary, setAiSummary] = useState('')
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [reportData, setReportData] = useState(null)

  const monthName = format(selectedMonth, 'MMMM yyyy')
  const daysInMonth = getDaysInMonth(selectedMonth)

  useEffect(() => {
    fetchData()
  }, [selectedMonth, session.user.id])

  async function fetchData() {
    setLoading(true)
    setAiSummary('')
    const start = format(startOfMonth(selectedMonth), 'yyyy-MM-dd')
    const end = format(endOfMonth(selectedMonth), 'yyyy-MM-dd')

    const { data } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', session.user.id)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })

    setLogs(data || [])
    setReportData(computeStats(data || []))
    setLoading(false)
  }

  function computeStats(logs) {
    const withSleep = logs.filter(l => l.sleep_duration > 0)
    const withRecovery = logs.filter(l => l.recovery_score > 0)
    const withHrv = logs.filter(l => l.hrv > 0)
    const withRhr = logs.filter(l => l.rhr > 0)
    const withSteps = logs.filter(l => l.steps > 0)
    const withWeight = logs.filter(l => l.weight > 0)
    const withCalories = logs.filter(l => l.calories > 0)

    const avg = (arr, key) => arr.length ? +(arr.reduce((a, l) => a + l[key], 0) / arr.length).toFixed(1) : null
    const avgInt = (arr, key) => arr.length ? Math.round(arr.reduce((a, l) => a + l[key], 0) / arr.length) : null
    const max = (arr, key) => arr.length ? Math.max(...arr.map(l => l[key])) : null

    const totalGym = logs.filter(l => l.activity?.includes('gym')).length
    const totalRun = logs.filter(l => l.activity?.includes('run')).length
    const totalSauna = logs.filter(l => l.activity?.includes('sauna')).length
    const totalHome = logs.filter(l => l.activity?.includes('home')).length

    const habitKeys = ['reading', 'meditation', 'nophone', 'journal']
    const totalHabitOccurrences = logs.reduce((a, l) => a + (l.habits?.length || 0), 0)
    const maxHabitOccurrences = logs.length * habitKeys.length
    const habitRate = maxHabitOccurrences > 0 ? Math.round((totalHabitOccurrences / maxHabitOccurrences) * 100) : 0

    const firstWeight = withWeight[0]?.weight
    const lastWeight = withWeight[withWeight.length - 1]?.weight
    const weightChange = firstWeight && lastWeight ? +(lastWeight - firstWeight).toFixed(1) : null

    const calorieTarget = settings?.calorie_target || 1900
    const daysUnderCalTarget = withCalories.filter(l => l.calories <= calorieTarget).length

    return {
      daysLogged: logs.length,
      daysInMonth,
      avgSleep: avg(withSleep, 'sleep_duration'),
      bestSleep: max(withSleep, 'sleep_duration')?.toFixed(1),
      avgRestorativeSleep: avg(withSleep, 'sleep_restorative'),
      avgSleepEfficiency: avgInt(withSleep, 'sleep_efficiency'),
      avgRecovery: avgInt(withRecovery, 'recovery_score'),
      bestRecovery: max(withRecovery, 'recovery_score'),
      avgHrv: avg(withHrv, 'hrv'),
      avgRhr: avgInt(withRhr, 'rhr'),
      avgSteps: avgInt(withSteps, 'steps') ? (avgInt(withSteps, 'steps') || 0).toLocaleString() : null,
      weightChange,
      firstWeight,
      lastWeight,
      totalGym,
      totalRun,
      totalSauna,
      totalHome,
      habitRate,
      totalHabitOccurrences,
      daysUnderCalTarget,
      totalCalDays: withCalories.length,
      avgCalories: avgInt(withCalories, 'calories'),
    }
  }

  async function handleGenerateSummary() {
    if (!reportData) return
    setGeneratingSummary(true)
    try {
      const summary = await generateMonthlyAISummary(reportData, lang, monthName)
      setAiSummary(summary)
    } catch (e) {
      setAiSummary(lang === 'de' ? 'Zusammenfassung konnte nicht generiert werden.' : 'Could not generate summary.')
    }
    setGeneratingSummary(false)
  }

  function handleExportPDF() {
    window.print()
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, flexDirection: 'column', gap: 12 }}>
        <div className="spinner" />
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>{lang === 'de' ? 'Lade Daten...' : 'Loading data...'}</div>
      </div>
    )
  }

  const d = reportData

  return (
    <>
      {/* Print styles injected inline */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-page { padding: 20px !important; }
          body { background: white !important; color: black !important; }
          .card { border: 1px solid #ddd !important; background: white !important; break-inside: avoid; }
        }
      `}</style>

      <div className="print-page" style={{ paddingBottom: 40 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 0', marginBottom: 4 }} className="no-print">
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'inherit', padding: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {lang === 'de' ? 'Zurück' : 'Back'}
          </button>
          <button onClick={handleExportPDF} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 20, background: 'var(--green)', border: 'none', color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3M2 10v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            PDF
          </button>
        </div>

        {/* Month selector */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }} className="no-print">
          <button onClick={() => setSelectedMonth(m => subMonths(m, 1))} style={{ width: 32, height: 32, borderRadius: '50%', border: '0.5px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L4 7l5 4" stroke="var(--text2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{monthName}</div>
          <button onClick={() => setSelectedMonth(m => { const next = new Date(m.getFullYear(), m.getMonth() + 1, 1); return next > new Date() ? m : next })} style={{ width: 32, height: 32, borderRadius: '50%', border: '0.5px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l5 4-5 4" stroke="var(--text2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* Print header */}
        <div style={{ display: 'none' }} className="print-header">
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>sebs.health</h1>
          <p style={{ color: '#666', margin: '0 0 20px' }}>{lang === 'de' ? 'Monatsbericht' : 'Monthly Report'} · {monthName}</p>
        </div>

        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text2)', fontSize: 14 }}>
            {lang === 'de' ? `Keine Daten für ${monthName}` : `No data for ${monthName}`}
          </div>
        ) : (
          <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Coverage */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">{lang === 'de' ? 'Übersicht' : 'Overview'}</span>
                <span className="badge badge-green">{d.daysLogged} / {d.daysInMonth} {lang === 'de' ? 'Tage' : 'days'}</span>
              </div>
              <div style={{ padding: '10px 14px 14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[
                    { label: lang === 'de' ? 'Gym' : 'Gym', value: d.totalGym, icon: '🏋️' },
                    { label: lang === 'de' ? 'Laufen' : 'Runs', value: d.totalRun, icon: '🏃' },
                    { label: 'Sauna', value: d.totalSauna, icon: '🧖' },
                    { label: lang === 'de' ? 'Zuhause' : 'Home', value: d.totalHome, icon: '🤸' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 16 }}>{s.icon}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)', marginTop: 2 }}>{s.value}</div>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginTop: 1 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sleep */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">💤 {lang === 'de' ? 'Schlaf' : 'Sleep'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>{d.avgSleep ? `⌀ ${fmtHours(d.avgSleep)}` : '—'}</span>
              </div>
              <div style={{ padding: '8px 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  { label: lang === 'de' ? 'Beste Nacht' : 'Best night', value: fmtHours(d.bestSleep), color: 'var(--blue)' },
                  { label: lang === 'de' ? 'Erholsam ⌀' : 'Restorative avg', value: fmtHours(d.avgRestorativeSleep), color: 'var(--purple)' },
                  { label: lang === 'de' ? 'Effizienz ⌀' : 'Efficiency avg', value: d.avgSleepEfficiency ? `${d.avgSleepEfficiency}%` : '—', color: 'var(--green)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recovery */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">⚡ {lang === 'de' ? 'Erholung' : 'Recovery'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{d.avgRecovery ? `⌀ ${d.avgRecovery}%` : '—'}</span>
              </div>
              <div style={{ padding: '8px 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  { label: lang === 'de' ? 'Beste Erholung' : 'Best recovery', value: d.bestRecovery ? `${d.bestRecovery}%` : '—', color: 'var(--green)' },
                  { label: 'HRV ⌀', value: d.avgHrv ? `${d.avgHrv}ms` : '—', color: 'var(--purple)' },
                  { label: lang === 'de' ? 'Ruhepuls ⌀' : 'RHR avg', value: d.avgRhr ? `${d.avgRhr}bpm` : '—', color: 'var(--text)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Body & Steps */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">📊 {lang === 'de' ? 'Körper & Schritte' : 'Body & Steps'}</span>
              </div>
              <div style={{ padding: '8px 14px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  {
                    label: lang === 'de' ? 'Gewichtsveränderung' : 'Weight change',
                    value: d.weightChange !== null ? `${d.weightChange > 0 ? '+' : ''}${d.weightChange} kg` : '—',
                    sub: d.firstWeight && d.lastWeight ? `${d.firstWeight} → ${d.lastWeight} kg` : null,
                    color: d.weightChange < 0 ? 'var(--green)' : d.weightChange > 0 ? 'var(--red)' : 'var(--text)',
                  },
                  {
                    label: lang === 'de' ? 'Schritte ⌀/Tag' : 'Avg steps/day',
                    value: d.avgSteps || '—',
                    color: 'var(--green)',
                  },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
                    {s.sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{s.sub}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Habits */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">✅ {lang === 'de' ? 'Gewohnheiten' : 'Habits'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: d.habitRate >= 70 ? 'var(--green)' : 'var(--amber)' }}>{d.habitRate}%</span>
              </div>
              <div style={{ padding: '10px 14px 14px' }}>
                <div className="bar-wrap-lg" style={{ marginBottom: 6 }}>
                  <div className="bar bar-green" style={{ width: `${d.habitRate}%` }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  {d.totalHabitOccurrences} {lang === 'de' ? 'Gewohnheiten erfüllt diesen Monat' : 'habits completed this month'}
                </div>
                {d.totalCalDays > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                    🥗 {d.daysUnderCalTarget}/{d.totalCalDays} {lang === 'de' ? 'Tage unter Kalorienziel' : 'days under calorie target'} · ⌀ {d.avgCalories?.toLocaleString()} kcal
                  </div>
                )}
              </div>
            </div>

            {/* AI Summary */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">✨ {lang === 'de' ? 'KI-Analyse' : 'AI Analysis'}</span>
              </div>
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {aiSummary ? (
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiSummary}</div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                    {lang === 'de'
                      ? 'Lass Claude deinen Monat analysieren — Highlights, Verbesserungsbereiche und Empfehlungen für den nächsten Monat.'
                      : 'Let Claude analyse your month — highlights, areas to improve, and recommendations for next month.'}
                  </div>
                )}
                {!aiSummary && (
                  <button
                    className="btn-primary"
                    onClick={handleGenerateSummary}
                    disabled={generatingSummary}
                  >
                    {generatingSummary
                      ? (lang === 'de' ? 'Analysiere...' : 'Analysing...')
                      : (lang === 'de' ? 'Monat analysieren' : 'Analyse this month')}
                  </button>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </>
  )
}
