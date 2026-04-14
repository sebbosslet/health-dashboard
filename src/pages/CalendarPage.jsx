import { useLang } from '../lib/LangContext'
import { useState, useMemo } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isFuture, startOfDay, subMonths, addMonths } from 'date-fns'
import { useMonthLogs } from '../hooks/useData'

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function logScore(log) {
  if (!log) return 0
  let score = 0
  if (log.sleep_duration) score++
  if (log.calories) score++
  if (log.supplements?.length) score++
  if (log.activity?.length || log.habits?.length) score++
  return score
}

export default function CalendarPage({ session }) {
  const { t } = useLang()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedLog, setSelectedLog] = useState(null)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth() + 1
  const { logs } = useMonthLogs(session.user.id, year, month)

  const logsByDate = useMemo(() => {
    const map = {}
    logs.forEach(l => { map[l.date] = l })
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
        {log.sleep_duration && <div className="dot dot-sleep" />}
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
              <div key={dateStr} className={getCellClass(day)} onClick={() => !future && log && setSelectedLog(log)}>
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
        <div className="sheet-overlay" onClick={() => setSelectedLog(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '0.5px solid var(--border)', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{format(new Date(selectedLog.date), 'EEEE d MMM')}</div>
                {selectedLog.weight && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{selectedLog.weight} kg · Renpho</div>}
              </div>
              {selectedLog.recovery_score && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{Math.round(selectedLog.recovery_score)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text2)' }}>Recovery score</div>
                </div>
              )}
            </div>

            {/* Sleep */}
            {selectedLog.sleep_duration && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Sleep <span className="source-pill source-whoop">WHOOP</span>
                </div>
                {[
                  ['Duration', `${selectedLog.sleep_duration?.toFixed(1)}h`, 'var(--blue)'],
                  ['Efficiency', `${Math.round(selectedLog.sleep_efficiency || 0)}%`, 'var(--green)'],
                  ['Restorative', `${selectedLog.sleep_restorative?.toFixed(1)}h`, 'var(--purple)'],
                  ['HRV', `${Math.round(selectedLog.hrv || 0)}ms`, 'var(--purple)'],
                  ['RHR', `${Math.round(selectedLog.rhr || 0)}bpm`, 'var(--text)'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color }}>{val}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Activity / Steps */}
            <div style={{ padding: '0 16px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                Activity <span className="source-pill source-apple">Apple Health</span>
              </div>
              {selectedLog.steps && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>Steps</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{selectedLog.steps.toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Nutrition */}
            <div style={{ padding: '0 16px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>Nutrition</div>
              {[
                ['Calories', selectedLog.calories ? `${selectedLog.calories.toLocaleString()} kcal` : '—', 'var(--amber)'],
                ['Water', selectedLog.water ? `${selectedLog.water.toLocaleString()} ml` : '—', 'var(--blue)'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Habits */}
            {(selectedLog.activity?.length > 0 || selectedLog.habits?.length > 0) && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>Habits &amp; activity</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {[...(selectedLog.activity || []), ...(selectedLog.habits || [])].map(h => (
                    <span key={h} className="habit-chip habit-chip-done" style={{ textTransform: 'capitalize' }}>{h}</span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ padding: '0 16px' }}>
              <button className="btn-secondary" style={{ width: '100%', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setSelectedLog(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L5 11H3v-2l6.5-6.5z" stroke="var(--green)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>Edit this day's log</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
