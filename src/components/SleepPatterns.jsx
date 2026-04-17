import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'

const pct = (n, t) => t ? Math.round(n / t * 100) : 0

function CorrRow({ icon, label, yesLabel, yesVal, noLabel, noVal, nYes, unit = '%', invert = false }) {
  if (yesVal == null || nYes < 2) return null
  const delta = noVal != null ? +(yesVal - noVal).toFixed(1) : null
  const positive = invert ? delta < 0 : delta > 0
  const color = delta == null || Math.abs(delta) < 0.5 ? 'var(--text3)' : positive ? 'var(--green)' : 'var(--red)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, alignItems: 'start', padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
      <span style={{ fontSize: 15, lineHeight: 1.4 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
          {yesLabel}: <strong style={{ color: 'var(--text)' }}>{yesVal}{unit}</strong>
          {noVal != null && <span> · {noLabel}: <strong style={{ color: 'var(--text)' }}>{noVal}{unit}</strong></span>}
          <span style={{ color: 'var(--text3)', marginLeft: 6 }}>n={nYes}</span>
        </div>
      </div>
      {delta != null && Math.abs(delta) >= 0.5 && (
        <span style={{ fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap', paddingTop: 2 }}>
          {delta > 0 ? '+' : ''}{delta}{unit}
        </span>
      )}
    </div>
  )
}

export default function SleepPatterns({ userId }) {
  const { lang } = useLang()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | empty | error

  useEffect(() => {
    if (!userId) { setStatus('empty'); return }

    Promise.all([
      supabase.from('daily_logs').select('date,recovery_score,hrv,rhr,sleep_duration,sleep_efficiency,phone_away_time,wind_down,ac_temp,dinner_time,home_time,activity,habits,water,steps,bed_time').eq('user_id', userId).order('date', { ascending: true }).limit(90),
      supabase.from('sleep_hr_analysis').select('date,stability_score,deep_pct,rem_pct,awake_pct,spike_count,likely_cause').eq('user_id', userId).order('date', { ascending: true }).limit(90),
      supabase.from('meal_logs').select('date,is_caffeinated,is_alcohol,consumed_at').eq('user_id', userId).order('date', { ascending: false }).limit(300),
    ]).then(([r1, r2, r3]) => {
      if (r1.error || r2.error) { setStatus('error'); return }

      const logs = r1.data || []
      const hr = r2.data || []
      const meals = r3.data || []

      if (logs.length < 4) { setStatus('empty'); return }

      // ── Helpers ──
      const avg = arr => {
        const v = arr.filter(x => x != null && !isNaN(x))
        return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null
      }
      const pct = (n, t) => t ? Math.round(n / t * 100) : 0

      // ── Build lookups ──
      const hrMap = {}
      hr.forEach(d => { hrMap[d.date] = d })

      const mealMap = {}
      meals.forEach(m => {
        if (!mealMap[m.date]) mealMap[m.date] = []
        mealMap[m.date].push(m)
      })

      // ── Enrich logs ──
      const enriched = logs.map(l => ({
        ...l,
        stability: hrMap[l.date]?.stability_score ?? null,
        deep_pct: hrMap[l.date]?.deep_pct ?? null,
        rem_pct: hrMap[l.date]?.rem_pct ?? null,
        awake_pct: hrMap[l.date]?.awake_pct ?? null,
        spike_count: hrMap[l.date]?.spike_count ?? null,
        likely_cause: hrMap[l.date]?.likely_cause ?? null,
        had_alcohol: (mealMap[l.date] || []).some(m => m.is_alcohol),
        caffeine_late: (mealMap[l.date] || []).some(m => m.is_caffeinated && m.consumed_at >= '17:00'),
      }))

      // ── Split helper: compare two groups on a metric ──
      const split = (condYes, condNo, metric) => {
        const yes = enriched.filter(condYes).map(l => l[metric]).filter(v => v != null)
        const no = enriched.filter(condNo).map(l => l[metric]).filter(v => v != null)
        return { yes: avg(yes), no: avg(no), nYes: yes.length, nNo: no.length }
      }

      // ── Next-day split ──
      const nextDay = (cond, metric) => {
        const yes = [], no = []
        for (let i = 0; i < enriched.length - 1; i++) {
          const v = enriched[i + 1][metric]
          if (v == null) continue
          if (cond(enriched[i])) yes.push(v)
          else no.push(v)
        }
        return { yes: avg(yes), no: avg(no), nYes: yes.length, nNo: no.length }
      }

      // ── Baselines ──
      const baseline = {
        recovery: avg(enriched.map(l => l.recovery_score).filter(Boolean)),
        hrv: avg(enriched.map(l => l.hrv).filter(Boolean)),
        rhr: avg(enriched.map(l => l.rhr).filter(Boolean)),
        duration: avg(enriched.map(l => l.sleep_duration).filter(Boolean)),
        efficiency: avg(enriched.map(l => l.sleep_efficiency).filter(Boolean)),
        stability: avg(enriched.map(l => l.stability).filter(Boolean)),
        deep: avg(enriched.map(l => l.deep_pct).filter(Boolean)),
        rem: avg(enriched.map(l => l.rem_pct).filter(Boolean)),
        awake: avg(enriched.map(l => l.awake_pct).filter(Boolean)),
        nights: logs.length,
        hrNights: hr.length,
      }

      // ── Trends (first half vs second half) ──
      const withRec = enriched.filter(l => l.recovery_score)
      const half = Math.floor(withRec.length / 2)
      const recoveryTrend = half >= 3
        ? +(avg(withRec.slice(half).map(l => l.recovery_score)) - avg(withRec.slice(0, half).map(l => l.recovery_score))).toFixed(1)
        : null

      // ── Disruption causes ──
      const causeCounts = {}
      hr.forEach(d => { if (d.likely_cause && d.likely_cause !== 'unclear') causeCounts[d.likely_cause] = (causeCounts[d.likely_cause] || 0) + 1 })
      const causes = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])

      // ── Correlations ──
      const c = {
        phoneEarlyRec: split(l => l.phone_away_time < '22:30' && l.phone_away_time, l => l.phone_away_time >= '23:00' && l.phone_away_time, 'recovery_score'),
        phoneEarlyStab: split(l => l.phone_away_time < '22:30' && l.phone_away_time, l => l.phone_away_time >= '23:00' && l.phone_away_time, 'stability'),
        windGoodRec: split(l => l.wind_down === 'good', l => l.wind_down === 'poor', 'recovery_score'),
        windGoodStab: split(l => l.wind_down === 'good', l => l.wind_down === 'poor', 'stability'),
        gymNextRec: nextDay(l => l.activity?.some(a => a.includes('gym')), 'recovery_score'),
        saunaNextRec: nextDay(l => l.activity?.some(a => a.includes('sauna')), 'recovery_score'),
        runNextRec: nextDay(l => l.activity?.some(a => a.includes('run')), 'recovery_score'),
        tempCoolStab: split(l => l.ac_temp <= 67 && l.ac_temp, l => l.ac_temp >= 70 && l.ac_temp, 'stability'),
        dinnerEarlyStab: split(l => l.dinner_time < '19:00' && l.dinner_time, l => l.dinner_time >= '20:30' && l.dinner_time, 'stability'),
        alcoholRec: split(l => l.had_alcohol, l => !l.had_alcohol, 'recovery_score'),
        alcoholStab: split(l => l.had_alcohol, l => !l.had_alcohol, 'stability'),
        alcoholSpikes: split(l => l.had_alcohol, l => !l.had_alcohol, 'spike_count'),
        caffeineEff: split(l => l.caffeine_late, l => !l.caffeine_late, 'sleep_efficiency'),
        caffeineStab: split(l => l.caffeine_late, l => !l.caffeine_late, 'stability'),
        meditationRec: nextDay(l => l.habits?.some(h => h.includes('meditat')), 'recovery_score'),
        waterRec: split(l => l.water >= 2000 && l.water, l => l.water < 1200 && l.water, 'recovery_score'),
        stepsRec: nextDay(l => l.steps >= 8000 && l.steps, 'recovery_score'),
        homeEarlyStab: split(l => l.home_time < '19:00' && l.home_time, l => l.home_time >= '21:00' && l.home_time, 'stability'),
      }

      setData({ baseline, causes, c, recoveryTrend })
      setStatus('ready')
    }).catch(err => {
      console.error('SleepPatterns error:', err)
      setStatus('error')
    })
  }, [userId])

  if (status === 'loading') return <div style={{ padding: '16px 14px', fontSize: 11, color: 'var(--text3)' }}>Analysing patterns...</div>
  if (status === 'error') return <div style={{ padding: '16px 14px', fontSize: 11, color: 'var(--text3)' }}>Pattern analysis unavailable.</div>
  if (status === 'empty' || !data) return <div style={{ padding: '16px 14px', fontSize: 11, color: 'var(--text3)' }}>Log more nights to unlock pattern analysis.</div>

  const { baseline, causes, c, recoveryTrend } = data
  const CAUSE_LABELS = { thyroid: 'Thyroid medication', stress: 'Stress / cortisol', apnea: 'Sleep apnea', temperature: 'Temperature', food: 'Food / digestion', caffeine: 'Caffeine', alcohol: 'Alcohol', mixed: 'Multiple factors' }
  const CAUSE_COLORS = { thyroid: 'var(--blue)', stress: 'var(--amber)', apnea: 'var(--red)', temperature: 'var(--purple)', food: 'var(--amber)', caffeine: 'var(--amber)', alcohol: 'var(--purple)', mixed: 'var(--text2)' }

  return (
    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Baselines ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          📊 Your baselines · {baseline.nights} nights · {baseline.hrNights} HR analysed
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
          {[
            { label: 'Recovery', v: baseline.recovery, u: '%', color: baseline.recovery >= 67 ? 'var(--green)' : baseline.recovery >= 34 ? 'var(--amber)' : 'var(--red)' },
            { label: 'HRV', v: baseline.hrv, u: 'ms', color: 'var(--purple)' },
            { label: 'RHR', v: baseline.rhr, u: 'bpm', color: 'var(--blue)' },
            { label: 'Sleep', v: baseline.duration, u: 'h', color: 'var(--blue)' },
            { label: 'Efficiency', v: baseline.efficiency, u: '%', color: 'var(--green)' },
            { label: 'Stability', v: baseline.stability, u: '/10', color: baseline.stability >= 7 ? 'var(--green)' : 'var(--amber)' },
            { label: 'Deep', v: baseline.deep, u: '%', color: 'var(--purple)' },
            { label: 'REM', v: baseline.rem, u: '%', color: 'var(--green)' },
            { label: 'Awake', v: baseline.awake, u: '%', color: baseline.awake > 12 ? 'var(--red)' : 'var(--text2)' },
          ].filter(m => m.v != null).map(m => (
            <div key={m.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '7px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.v}{m.u}</div>
            </div>
          ))}
        </div>
        {recoveryTrend != null && (
          <div style={{ fontSize: 11, color: recoveryTrend >= 0 ? 'var(--green)' : 'var(--red)' }}>
            Recovery {recoveryTrend >= 0 ? '↑ improving' : '↓ declining'} {recoveryTrend >= 0 ? '+' : ''}{recoveryTrend}% over tracked period
          </div>
        )}
      </div>

      {/* ── Disruption causes ── */}
      {causes.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            ⚡ Sleep disruption causes ({baseline.hrNights} nights analysed)
          </div>
          {causes.map(([cause, n]) => (
            <div key={cause} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: 'var(--text)' }}>{CAUSE_LABELS[cause] || cause}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{n}× · {pct(n, baseline.hrNights)}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--surface2)', borderRadius: 3 }}>
                <div style={{ height: 5, borderRadius: 3, background: CAUSE_COLORS[cause] || 'var(--text3)', width: pct(n, baseline.hrNights) + '%', transition: 'width 0.4s' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Behaviour correlations ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          🔬 Behaviour → sleep outcomes
        </div>
        <CorrRow icon="📵" label="Phone away ≤22:30 vs ≥23:00 → recovery" yesLabel="Early" yesVal={c.phoneEarlyRec.yes} noLabel="Late" noVal={c.phoneEarlyRec.no} nYes={c.phoneEarlyRec.nYes} />
        <CorrRow icon="📵" label="Phone away ≤22:30 vs ≥23:00 → stability" yesLabel="Early" yesVal={c.phoneEarlyStab.yes} noLabel="Late" noVal={c.phoneEarlyStab.no} nYes={c.phoneEarlyStab.nYes} unit="/10" />
        <CorrRow icon="😌" label="Good vs poor wind-down → recovery" yesLabel="Good" yesVal={c.windGoodRec.yes} noLabel="Poor" noVal={c.windGoodRec.no} nYes={c.windGoodRec.nYes} />
        <CorrRow icon="😌" label="Good vs poor wind-down → stability" yesLabel="Good" yesVal={c.windGoodStab.yes} noLabel="Poor" noVal={c.windGoodStab.no} nYes={c.windGoodStab.nYes} unit="/10" />
        <CorrRow icon="🏠" label="Home ≤19:00 vs ≥21:00 → stability" yesLabel="Early" yesVal={c.homeEarlyStab.yes} noLabel="Late" noVal={c.homeEarlyStab.no} nYes={c.homeEarlyStab.nYes} unit="/10" />
        <CorrRow icon="❄" label="Cool room (≤67°F) vs warm (≥70°F) → stability" yesLabel="≤67°F" yesVal={c.tempCoolStab.yes} noLabel="≥70°F" noVal={c.tempCoolStab.no} nYes={c.tempCoolStab.nYes} unit="/10" />
        <CorrRow icon="🍽" label="Dinner ≤19:00 vs ≥20:30 → stability" yesLabel="Early" yesVal={c.dinnerEarlyStab.yes} noLabel="Late" noVal={c.dinnerEarlyStab.no} nYes={c.dinnerEarlyStab.nYes} unit="/10" />
        <CorrRow icon="🍷" label="Alcohol nights → recovery" yesLabel="Alcohol" yesVal={c.alcoholRec.yes} noLabel="None" noVal={c.alcoholRec.no} nYes={c.alcoholRec.nYes} />
        <CorrRow icon="🍷" label="Alcohol nights → HR stability" yesLabel="Alcohol" yesVal={c.alcoholStab.yes} noLabel="None" noVal={c.alcoholStab.no} nYes={c.alcoholStab.nYes} unit="/10" />
        <CorrRow icon="🍷" label="Alcohol → HR spikes" yesLabel="Alcohol" yesVal={c.alcoholSpikes.yes} noLabel="None" noVal={c.alcoholSpikes.no} nYes={c.alcoholSpikes.nYes} unit="" invert={true} />
        <CorrRow icon="☕" label="Late caffeine (>17:00) → sleep efficiency" yesLabel="Late caffeine" yesVal={c.caffeineEff.yes} noLabel="None" noVal={c.caffeineEff.no} nYes={c.caffeineEff.nYes} />
        <CorrRow icon="☕" label="Late caffeine → stability" yesLabel="Late caffeine" yesVal={c.caffeineStab.yes} noLabel="None" noVal={c.caffeineStab.no} nYes={c.caffeineStab.nYes} unit="/10" />
        <CorrRow icon="🏋️" label="Gym day → next day recovery" yesLabel="After gym" yesVal={c.gymNextRec.yes} noLabel="No gym" noVal={c.gymNextRec.no} nYes={c.gymNextRec.nYes} />
        <CorrRow icon="🧖" label="Sauna day → next day recovery" yesLabel="After sauna" yesVal={c.saunaNextRec.yes} noLabel="No sauna" noVal={c.saunaNextRec.no} nYes={c.saunaNextRec.nYes} />
        <CorrRow icon="🏃" label="Run day → next day recovery" yesLabel="After run" yesVal={c.runNextRec.yes} noLabel="No run" noVal={c.runNextRec.no} nYes={c.runNextRec.nYes} />
        <CorrRow icon="🧘" label="Meditation → next day recovery" yesLabel="With" yesVal={c.meditationRec.yes} noLabel="Without" noVal={c.meditationRec.no} nYes={c.meditationRec.nYes} />
        <CorrRow icon="💧" label="Well hydrated (≥2L) → recovery" yesLabel="≥2L" yesVal={c.waterRec.yes} noLabel="<1.2L" noVal={c.waterRec.no} nYes={c.waterRec.nYes} />
        <CorrRow icon="👟" label="Active day (≥8k steps) → next recovery" yesLabel="≥8k" yesVal={c.stepsRec.yes} noLabel="Less" noVal={c.stepsRec.no} nYes={c.stepsRec.nYes} />
      </div>

    </div>
  )
}
