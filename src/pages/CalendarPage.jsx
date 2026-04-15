import { useLang } from '../lib/LangContext'
import { useState, useMemo, useEffect } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isFuture, startOfDay, subMonths, addMonths } from 'date-fns'
import { useMonthLogs } from '../hooks/useData'
import { supabase } from '../lib/supabase'

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function fmtHours(h) {
  if (!h || h <= 0) return '—'
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

function logScore(log) {
  if (!log) return 0
  let score = 0
  if (log.sleep_duration || log.recovery_score) score++ // WHOOP sleep/recovery
  if (log.calories) score++                              // nutrition
  if (log.supplements?.length) score++                  // supplements
  if (log.activity?.length || log.habits?.length) score++ // habits
  if (log.steps) score++                                 // steps from Apple Health
  return score
}

export default function CalendarPage({ session }) {
  const { t, lang } = useLang()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedLog, setSelectedLog] = useState(null)
  const [selectedEvents, setSelectedEvents] = useState([])

  function selectDay(log) {
    setSelectedLog(log)
    setSelectedEvents([])
    if (log) {
      supabase.from('daily_events').select('*').eq('user_id', session.user.id).eq('date', log.date)
        .then(({ data }) => setSelectedEvents(data || []))
    }
  }

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth() + 1
  const { logs } = useMonthLogs(session.user.id, year, month)

  const logsByDate = useMemo(() => {
    const map = {}
    logs.forEach(l => { map[l.date] = l })
    console.log('CalendarPage logs:', logs.length, 'dates:', Object.keys(map).slice(0,5))
    return map
  }, [logs])

  const days = useMemo(() => {
    const start = startOfMonth(currentMonth)
    const end = endOfMonth(currentMonth)
    return eachDayOfInterval({ start, end })
  }, [currentMonth])

  const blanks = useMemo(() => {
    const dow = getDay(startOfMonth(currentMonth))
    return dow === 0 ? 6 : dow - 1
  }, [currentMonth])

  const today = startOfDay(new Date())
  const isPastMonth = endOfMonth(currentMonth) < today

  // Month stats
  const monthStats = useMemo(() => {
    if (!logs.length) return null
    const withWeight = logs.filter(l => l.weight)
    const withSleep = logs.filter(l => l.sleep_duration)
    const withSteps = logs.filter(l => l.steps)

    const firstW = withWeight[0]?.weight
    const lastW = withWeight[withWeight.length - 1]?.weight
    const weightChange = firstW && lastW ? +(lastW - firstW).toFixed(1) : null

    const avgSleep = withSleep.length ? +(withSleep.reduce((a, l) => a + l.sleep_duration, 0) / withSleep.length).toFixed(1) : null
    const avgSteps = withSteps.length ? Math.round(withSteps.reduce((a, l) => a + l.steps, 0) / withSteps.length) : null

    return { weightChange, avgSleep, avgSteps }
  }, [logs])

  function getCellClass(day) {
    const dateStr = format(day, 'yyyy-MM-dd')
    const log = logsByDate[dateStr]
    const isToday = isSameDay(day, today)
    const future = isFuture(startOfDay(day)) && !isToday

    if (future) return 'cal-cell future'
    if (!log) return 'cal-cell'
    const score = logScore(log)
    if (score >= 3) return `cal-cell logged ${isToday ? 'today' : ''}`
    if (score >= 1) return `cal-cell partial ${isToday ? 'today' : ''}`
    return `cal-cell ${isToday ? 'today' : ''}`
  }

  function getDots(day) {
    const dateStr = format(day, 'yyyy-MM-dd')
    const log = logsByDate[dateStr]
    if (!log) return null
    return (
      <div className="dot-row">
        {(log.sleep_duration || log.recovery_score) && <div className="dot dot-sleep" />}
        {(log.activity?.length > 0) && <div className="dot dot-activity" />}
        {log.calories && <div className="dot dot-calories" />}
        {log.supplements?.length > 0 && <div className="dot dot-supps" />}
      </div>
    )
  }

  const isCurrentMonth = format(currentMonth, 'yyyy-MM') === format(new Date(), 'yyyy-MM')
  const mtdLabel = isCurrentMonth ? 'Month to date' : format(currentMonth, 'MMMM yyyy')

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">{`${t('cal_title')}`}</div>
        <div style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600 }}>
          Year view
        </div>
      </div>

      {/* Month navigation */}
      <div style={{ background: 'var(--surface)', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 6px' }}>
          <button onClick={() => setCurrentMonth(m => subMonths(m, 1))} style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface2)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6l4 4" stroke="var(--text)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{format(currentMonth, 'MMMM yyyy')}</span>
          <button onClick={() => setCurrentMonth(m => addMonths(m, 1))} style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface2)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: isCurrentMonth ? 0.35 : 1 }} disabled={isCurrentMonth}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2L8.5 6l-4 4" stroke="var(--text)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* Day labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '4px 12px 2px' }}>
          {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--text2)', padding: '3px 0' }}>{d}</div>)}
        </div>

        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, padding: '4px 12px 10px' }}>
          {Array(blanks).fill(null).map((_, i) => <div key={`b${i}`} className="cal-cell empty" />)}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd')
            const log = logsByDate[dateStr]
            const isToday = isSameDay(day, today)
            const future = isFuture(startOfDay(day)) && !isToday
            return (
              <div key={dateStr} className={getCellClass(day)} onClick={() => !future && log && selectDay(log)}>
                {format(day, 'd')}
                {!future && getDots(day)}
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, padding: '4px 12px 10px', flexWrap: 'wrap' }}>
          {[
            { cls: 'sq-full', color: 'var(--green-light)', label: t('cal_fully_logged') },
            { cls: 'sq-partial', color: 'var(--amber-light)', label: t('cal_partial') },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text2)' }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color, border: '0.5px solid var(--border)' }} />
              {l.label}
            </div>
          ))}
          {[
            { color: 'var(--blue)', label: 'Sleep' },
            { color: 'var(--green)', label: 'Activity' },
            { color: 'var(--amber)', label: 'Calories' },
            { color: 'var(--purple)', label: 'Supps' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text2)' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Month stats */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {monthStats && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ background: 'var(--surface)', padding: '9px 10px' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{isCurrentMonth ? 'MTD' : 'Month'}</div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 2 }}>Weight change</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: monthStats.weightChange < 0 ? 'var(--green)' : monthStats.weightChange > 0 ? 'var(--red)' : 'var(--text)' }}>
                {monthStats.weightChange !== null ? `${monthStats.weightChange > 0 ? '+' : ''}${monthStats.weightChange}kg` : '—'}
              </div>
            </div>
            <div style={{ background: 'var(--surface)', padding: '9px 10px' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{isCurrentMonth ? 'MTD' : 'Month'}</div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 2 }}>Avg sleep</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--blue)' }}>
                {monthStats.avgSleep ? `${monthStats.avgSleep}h` : '—'}
              </div>
            </div>
            <div style={{ background: 'var(--surface)', padding: '9px 10px' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{isCurrentMonth ? 'MTD' : 'Month'}</div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 2 }}>Avg steps</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {monthStats.avgSteps ? `${(monthStats.avgSteps / 1000).toFixed(1)}k` : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Past month report link */}
        {isPastMonth && (
          <div style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Full month report available</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
              View
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="var(--green)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        )}
      </div>

      {/* Day detail sheet */}
      {selectedLog && (
        <div className="sheet-overlay" onClick={() => selectDay(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />

            {/* Header */}
            <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '0.5px solid var(--border)', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{format(new Date(selectedLog.date + 'T12:00'), 'EEEE d MMM')}</div>
                {selectedLog.weight && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>⚖️ {selectedLog.weight} kg</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {selectedLog.recovery_score && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: selectedLog.recovery_score >= 67 ? 'var(--green)' : selectedLog.recovery_score >= 34 ? 'var(--amber)' : 'var(--red)' }}>
                      {Math.round(selectedLog.recovery_score)}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text2)', textTransform: 'uppercase' }}>{t('metric_recovery')}</div>
                  </div>
                )}
                {/* Morning feel summary */}
                {(selectedLog.morning_energy || selectedLog.morning_mood) && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16 }}>
                      {selectedLog.morning_energy >= 4 ? '⚡' : selectedLog.morning_energy >= 3 ? '🙂' : '😴'}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text2)', textTransform: 'uppercase' }}>{selectedLog.morning_energy}/5</div>
                  </div>
                )}
              </div>
            </div>

            {/* Sleep & Recovery */}
            {(selectedLog.sleep_duration || selectedLog.recovery_score) && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  💤 {t('cal_sleep')} <span className="source-pill source-whoop">WHOOP</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                  {[
                    { label: t('metric_duration'), value: fmtHours(selectedLog.sleep_duration), color: 'var(--blue)' },
                    { label: t('metric_efficiency'), value: `${Math.round(selectedLog.sleep_efficiency || 0)}%`, color: 'var(--green)' },
                    { label: t('metric_restorative'), value: fmtHours(selectedLog.sleep_restorative), color: 'var(--purple)' },
                    { label: 'HRV', value: selectedLog.hrv ? `${Math.round(selectedLog.hrv)}ms` : '—', color: 'var(--purple)' },
                    { label: 'RHR', value: selectedLog.rhr ? `${Math.round(selectedLog.rhr)}bpm` : '—', color: 'var(--text)' },
                  ].map(m => (
                    <div key={m.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Morning feel detail */}
            {(selectedLog.morning_energy || selectedLog.morning_mood || selectedLog.morning_soreness) && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>
                  🌅 {lang === 'de' ? 'Morgen-Check-in' : 'Morning check-in'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                  {[
                    { label: lang === 'de' ? 'Energie' : 'Energy', value: selectedLog.morning_energy, emojis: ['','😴','😑','😐','🙂','⚡'] },
                    { label: lang === 'de' ? 'Stimmung' : 'Mood', value: selectedLog.morning_mood, emojis: ['','😞','😕','😐','😊','😄'] },
                    { label: lang === 'de' ? 'Kater' : 'Soreness', value: selectedLog.morning_soreness, emojis: ['','🔴','🟠','🟡','🟢','✅'] },
                  ].map(m => m.value > 0 && (
                    <div key={m.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
                      <div style={{ fontSize: 18 }}>{m.emojis[m.value]}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{m.value}/5</div>
                    </div>
                  ))}
                </div>
                {selectedLog.morning_note && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, fontStyle: 'italic' }}>"{selectedLog.morning_note}"</div>
                )}
              </div>
            )}

            {/* Evening log */}
            {(selectedLog.phone_away_time || selectedLog.bed_time || selectedLog.wind_down) && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>
                  🌙 {lang === 'de' ? 'Abend' : 'Evening'}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedLog.phone_away_time && (
                    <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>
                      📵 {selectedLog.phone_away_time.slice(0,5)}
                    </span>
                  )}
                  {selectedLog.bed_time && (
                    <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>
                      🛏 {selectedLog.bed_time.slice(0,5)}
                    </span>
                  )}
                  {selectedLog.phone_away_time && selectedLog.bed_time && (() => {
                    const pm = parseInt(selectedLog.phone_away_time.split(':')[0])*60 + parseInt(selectedLog.phone_away_time.split(':')[1])
                    const bm = parseInt(selectedLog.bed_time.split(':')[0])*60 + parseInt(selectedLog.bed_time.split(':')[1])
                    const gap = bm - pm
                    return gap > 0 ? (
                      <span style={{ fontSize: 12, padding: '4px 10px', background: gap >= 45 ? 'var(--green-light)' : 'rgba(186,117,23,0.1)', borderRadius: 20, color: gap >= 45 ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
                        {gap}min {lang === 'de' ? 'Gap' : 'gap'}
                      </span>
                    ) : null
                  })()}
                  {selectedLog.wind_down && (
                    <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>
                      {selectedLog.wind_down === 'good' ? '😌' : selectedLog.wind_down === 'ok' ? '😐' : '😣'} {selectedLog.wind_down}
                    </span>
                  )}
                </div>
                {selectedLog.evening_note && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, fontStyle: 'italic' }}>"{selectedLog.evening_note}"</div>
                )}
              </div>
            )}

            {/* Activity + steps */}
            {(selectedLog.activity?.length > 0 || selectedLog.steps) && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>
                  🏃 {t('cal_activity')}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {(selectedLog.activity || []).map(a => (
                    <span key={a} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--green-light)', borderRadius: 20, color: 'var(--green)', fontWeight: 500, textTransform: 'capitalize' }}>{a}</span>
                  ))}
                  {selectedLog.steps > 0 && (
                    <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>
                      👟 {selectedLog.steps.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Habits */}
            {selectedLog.habits?.length > 0 && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>
                  ✅ {lang === 'de' ? 'Gewohnheiten' : 'Habits'}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {selectedLog.habits.map(h => (
                    <span key={h} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20, textTransform: 'capitalize' }}>{h.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Nutrition */}
            {(selectedLog.calories || selectedLog.water) && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>
                  🥗 {t('cal_nutrition')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {selectedLog.calories && (
                    <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>
                      {selectedLog.calories.toLocaleString()} kcal
                    </span>
                  )}
                  {selectedLog.water && (
                    <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>
                      💧 {selectedLog.water} ml
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Daily context events */}
            {selectedEvents.length > 0 && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>
                  📌 {lang === 'de' ? 'Tages-Kontext' : 'Day context'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {selectedEvents.map(e => (
                    <span key={e.id} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', borderRadius: 20 }}>{e.label}</span>
                  ))}
                </div>
              </div>
            )}

            {/* AI insight */}
            {selectedLog.ai_insight && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 6 }}>
                  ✨ {lang === 'de' ? 'KI-Analyse' : 'AI Insight'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px' }}>
                  {selectedLog.ai_insight}
                </div>
              </div>
            )}

            <div style={{ padding: '0 16px 4px' }}>
              <button className="btn-secondary" style={{ width: '100%', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => selectDay(null)}>
                {lang === 'de' ? 'Schließen' : 'Close'}
              </button>
            </div>
            <div style={{ height: 8 }} />
          </div>
        </div>
      )}
    </>
  )
}
