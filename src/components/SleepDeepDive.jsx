import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format, subDays } from 'date-fns'


const FLAG_LABELS = { blood: 'Blood present', mucus: 'Mucus present', undigested_food: 'Undigested food', urgency: 'Urgency', pain: 'Pain', straining: 'Straining', incomplete: 'Incomplete evacuation', floating: 'Floating stool', oily: 'Oily/greasy' }
const fmtFlags = flags => flags.map(f => FLAG_LABELS[f] || f.replace(/_/g, ' ')).join(' · ')

// ── helpers ──────────────────────────────────────────────────────────────────
const avg = arr => {
  const v = arr.filter(x => x != null && !isNaN(x))
  return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null
}
const toMins = t => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const fmtMins = m => {
  if (m == null) return '—'
  const h = Math.floor(Math.abs(m) / 60), min = Math.abs(m) % 60
  return (m < 0 ? '-' : '') + (h > 0 ? h + 'h ' : '') + (min > 0 ? min + 'm' : (h > 0 ? '' : '0m'))
}

// ── Row component ─────────────────────────────────────────────────────────────
function FactorRow({ icon, label, lastNight, vsBaseline, unit = '', signal, detail }) {
  const color = signal === 'good' ? 'var(--green)' : signal === 'bad' ? 'var(--red)' : signal === 'warn' ? 'var(--amber)' : 'var(--text3)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, alignItems: 'start', padding: '8px 0', borderBottom: '0.5px solid var(--border)' }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {detail && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{detail}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{lastNight}{unit}</div>
        {vsBaseline != null && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{vsBaseline > 0 ? '+' : ''}{vsBaseline}{unit} vs avg</div>
        )}
      </div>
    </div>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ values, highlight, color = 'var(--blue)' }) {
  if (!values?.length) return null
  const valid = values.map(v => v ?? 0)
  const min = Math.min(...valid), max = Math.max(...valid)
  const range = max - min || 1
  const w = 6, gap = 3, h = 28
  const total = values.length * (w + gap) - gap
  return (
    <svg width={total} height={h} style={{ display: 'block' }}>
      {values.map((v, i) => {
        const barH = v != null ? Math.max(3, ((v - min) / range) * (h - 4)) : 3
        const isLast = i === highlight
        return (
          <rect key={i}
            x={i * (w + gap)} y={h - barH}
            width={w} height={barH}
            rx={2}
            fill={isLast ? 'var(--green)' : v != null ? color : 'var(--border)'}
            opacity={isLast ? 1 : 0.45}
          />
        )
      })}
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SleepDeepDive({ log, session }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const userId = session?.user?.id

  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    const sevenDaysAgo = format(subDays(new Date(), 8), 'yyyy-MM-dd')

    Promise.all([
      // Last 8 nights of daily logs for context
      supabase.from('daily_logs')
        .select('date,recovery_score,sleep_duration,sleep_efficiency,phone_away_time,wind_down,ac_temp,dinner_time,home_time,activity,habits,water,steps,bed_time,hrv,rhr')
        .eq('user_id', userId).gte('date', sevenDaysAgo).order('date', { ascending: true }),
      // Last 8 nights of HR analysis
      supabase.from('sleep_hr_analysis')
        .select('date,stability_score,spike_count,deep_pct,rem_pct,awake_pct,likely_cause,temp_avg_f,temp_min_f,temp_max_f')
        .eq('user_id', userId).gte('date', sevenDaysAgo).order('date', { ascending: true }),
      // Yesterday's meals — caffeine, alcohol
      supabase.from('meal_logs')
        .select('meal_name,consumed_at,is_caffeinated,is_alcohol,calories')
        .eq('user_id', userId).eq('date', yesterday).order('consumed_at', { ascending: true }),
      // Yesterday's poop logs
      supabase.from('poop_logs')
        .select('bristol_type,logged_at,flags,color,assessment')
        .eq('user_id', userId).eq('date', yesterday),
      // Yesterday's medications
      supabase.from('medication_logs')
        .select('taken,taken_time,medication_id')
        .eq('user_id', userId).eq('date', yesterday).eq('taken', true),
      supabase.from('medications')
        .select('id,name,fasted_flag')
        .eq('user_id', userId),
    ]).then(([r1, r2, r3, r4, r5, r6]) => {
      const recentLogs = r1.data || []
      const recentHr = r2.data || []
      const meals = r3.data || []
      const poops = r4.data || []
      const medLogs = r5.data || []
      const meds = r6.data || []

      // Yesterday's log + today's log (today has WHOOP metrics)
      const yLog = recentLogs.find(l => l.date === yesterday) || {}
      const tLog = log || {}

      // HR lookup
      const hrMap = {}
      recentHr.forEach(h => { hrMap[h.date] = h })
      // HR lookup — fetch strictly: today's record (this morning's upload for last night)
      // then fall back to yesterday's record. Never use a stale prop.
      const lastHr = hrMap[today] || hrMap[yesterday] || null

      // ── Baselines (exclude today/yesterday) ──
      const prior = recentLogs.filter(l => l.date < yesterday)
      const priorHr = recentHr.filter(h => h.date < yesterday)

      const baseRecovery = avg(prior.map(l => l.recovery_score).filter(Boolean))
      const baseStability = avg(priorHr.map(h => h.stability_score).filter(Boolean))
      const baseEfficiency = avg(prior.map(l => l.sleep_efficiency).filter(Boolean))

      // ── Verdict ──
      const todayRecovery = tLog.recovery_score
      const todayStability = lastHr?.stability_score
      const recoveryDelta = todayRecovery && baseRecovery ? +(todayRecovery - baseRecovery).toFixed(0) : null
      const stabilityDelta = todayStability && baseStability ? +(todayStability - baseStability).toFixed(1) : null

      // Rank last night vs recent 7 (prior nights only, not today)
      const recoveries = recentLogs.filter(l => l.date < today && l.recovery_score).map(l => l.recovery_score).sort((a, b) => b - a)
      const rank = todayRecovery && recoveries.length >= 2 ? recoveries.filter(r => r > todayRecovery).length + 1 : null
      const rankOf = recoveries.length >= 2 ? recoveries.length + 1 : null

      // ── Sparkline data — prior nights + today appended ──
      const spark7base = [...recentLogs.filter(l => l.date < today)].slice(-6)
      // Append today's data (from log prop, not recentLogs which excludes today)
      const sparkDays = [...spark7base, { date: today, recovery_score: tLog.recovery_score, _today: true }]
      const sparkRecovery = sparkDays.map(l => l.recovery_score ?? null)
      const sparkStability = sparkDays.map(l => (l._today ? lastHr : hrMap[l.date])?.stability_score ?? null)

      // ── Caffeine ──
      const caffeineMeals = meals.filter(m => m.is_caffeinated)
      const lastCaffeine = caffeineMeals.length ? caffeineMeals[caffeineMeals.length - 1] : null
      const bedMins = toMins(tLog.bed_time || yLog.bed_time)
      let caffeineHalfLivesAtSleep = null
      if (lastCaffeine?.consumed_at && bedMins != null) {
        let cafMins = toMins(lastCaffeine.consumed_at.slice(0, 5))
        if (cafMins > bedMins && cafMins > 1200) cafMins -= 1440 // midnight crossover
        const gapHours = (bedMins - cafMins) / 60
        caffeineHalfLivesAtSleep = gapHours > 0 ? +(gapHours / 5).toFixed(1) : null
      }
      // Avg caffeine gap on non-disrupted nights
      const avgCafBaseline = avg(
        prior.filter(l => {
          const hr = hrMap[l.date]
          return hr?.stability_score >= (baseStability || 6)
        }).map(l => {
          const phoneMin = toMins(l.phone_away_time)
          return phoneMin ? (phoneMin - 18 * 60) : null // rough proxy
        }).filter(Boolean)
      )

      // ── Alcohol ──
      const alcoholMeals = meals.filter(m => m.is_alcohol)

      // ── Meds ──
      const medDetails = medLogs.map(ml => {
        const med = meds.find(m => m.id === ml.medication_id)
        return { name: med?.name || 'Medication', fasted: med?.fasted_flag, takenTime: ml.taken_time }
      })
      const thyroxin = medDetails.find(m => m.name.toLowerCase().includes('thyrox') || m.name.toLowerCase().includes('thyroid') || m.name.toLowerCase().includes('levothyrox'))

      // ── Timing factors ──
      const phoneAwayMins = toMins(yLog.phone_away_time)
      const homeMins = toMins(yLog.home_time)
      const dinnerMins = toMins(yLog.dinner_time)
      const bedTimeMins = bedMins

      const avgHome = avg(prior.filter(l => l.home_time).map(l => toMins(l.home_time)))
      const avgDinner = avg(prior.filter(l => l.dinner_time).map(l => toMins(l.dinner_time)))

      // Wind-down gap: compute per-night phone→bed gap, then average those gaps
      const windDownGap = phoneAwayMins && bedTimeMins ? (() => {
        let b = bedTimeMins; if (b < 360) b += 1440; return b - phoneAwayMins
      })() : null
      const avgWindDownGap = avg(prior.filter(l => l.phone_away_time && l.bed_time).map(l => {
        const pm = toMins(l.phone_away_time)
        let bm = toMins(l.bed_time); if (bm < 360) bm += 1440
        const gap = bm - pm
        return gap > 0 && gap < 600 ? gap : null
      }).filter(Boolean))

      // ── Temperature ──
      const lastTemp = lastHr?.temp_avg_f || yLog.ac_temp
      const priorTemps = priorHr.filter(h => h.temp_avg_f).map(h => ({
        temp: h.temp_avg_f,
        stability: h.stability_score,
      }))
      const optimalTempRange = priorTemps.length >= 3 ? (() => {
        const good = priorTemps.filter(p => p.stability >= (baseStability || 6)).map(p => p.temp)
        return good.length ? { min: Math.min(...good), max: Math.max(...good), avg: avg(good) } : null
      })() : null

      // ── Poop ──
      const poopSummary = poops.length ? {
        count: poops.length,
        types: poops.map(p => p.bristol_type),
        flags: poops.flatMap(p => p.flags || []),
        hasFlags: poops.some(p => p.flags?.length > 0),
      } : null

      // ── Hydration ──
      const water = yLog.water
      const avgWater = avg(prior.filter(l => l.water).map(l => l.water))

      // ── What was different vs recent nights ──
      const comparisons = []
      if (recoveryDelta != null) {
        comparisons.push({
          metric: 'recovery',
          delta: recoveryDelta,
          better: recoveryDelta > 0,
          detail: `${todayRecovery}% vs ${baseRecovery}% avg`,
        })
      }
      if (stabilityDelta != null) {
        comparisons.push({
          metric: 'stability',
          delta: stabilityDelta,
          better: stabilityDelta > 0,
          detail: `${todayStability}/10 vs ${baseStability}/10 avg`,
        })
      }
      if (lastTemp && optimalTempRange) {
        const tempOk = lastTemp >= optimalTempRange.min - 1 && lastTemp <= optimalTempRange.max + 1
        comparisons.push({
          metric: 'temp',
          better: tempOk,
          detail: tempOk
            ? `${lastTemp}°F — within your ${optimalTempRange.min}–${optimalTempRange.max}°F sweet spot`
            : `${lastTemp}°F — outside your optimal ${optimalTempRange.min}–${optimalTempRange.max}°F range`,
        })
      }

      setData({
        yLog, tLog, lastHr,
        baseRecovery, baseStability, baseEfficiency,
        recoveryDelta, stabilityDelta, rank, rankOf,
        sparkRecovery, sparkStability,
        caffeineMeals, lastCaffeine, caffeineHalfLivesAtSleep,
        alcoholMeals, medDetails, thyroxin,
        phoneAwayMins, homeMins, dinnerMins, bedTimeMins,
        avgHome, avgDinner,
        windDownGap, avgWindDownGap,
        lastTemp, optimalTempRange,
        poopSummary, water, avgWater,
        comparisons,
      })
      setLoading(false)
    }).catch(err => {
      console.error('SleepDeepDive fetch error:', err)
      setLoading(false)
    })
  }, [userId, yesterday])

  if (loading) return (
    <div style={{ padding: '14px', fontSize: 11, color: 'var(--text3)' }}>Loading analysis...</div>
  )
  if (!data) return (
    <div style={{ padding: '14px', fontSize: 11, color: 'var(--text3)' }}>Analysis unavailable — check console for errors.</div>
  )

  const {
    yLog, tLog, lastHr,
    baseRecovery, baseStability,
    recoveryDelta, stabilityDelta, rank, rankOf,
    sparkRecovery, sparkStability,
    caffeineMeals, lastCaffeine, caffeineHalfLivesAtSleep,
    alcoholMeals, medDetails, thyroxin,
    phoneAwayMins, homeMins, dinnerMins, bedTimeMins,
    avgHome, avgDinner,
    windDownGap, avgWindDownGap,
    lastTemp, optimalTempRange,
    poopSummary, water, avgWater,
    comparisons,
  } = data

  const todayRecovery = tLog.recovery_score
  const todayStability = lastHr?.stability_score

  const SectionLabel = ({ children }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 4 }}>
      {children}
    </div>
  )

  // ── Build verdict explanation ───────────────────────────────────────────────
  const verdictColor = recoveryDelta == null ? 'var(--text2)' : recoveryDelta >= 5 ? 'var(--green)' : recoveryDelta <= -5 ? 'var(--red)' : 'var(--amber)'
  const verdictLabel = (() => {
    if (!todayRecovery && !todayStability) return 'Upload your WHOOP screenshot to unlock analysis'
    if (rank && rankOf) {
      if (rank === 1) return `Best night in ${rankOf} days`
      if (rank === rankOf) return `Worst night in ${rankOf} days`
      return `#${rank} of last ${rankOf} nights`
    }
    if (recoveryDelta != null) return recoveryDelta >= 5 ? 'Better than your recent average' : recoveryDelta <= -5 ? 'Below your recent average' : 'About average'
    return null
  })()

  // Build why-sentence from actual data
  const whyParts = []
  if (recoveryDelta != null && Math.abs(recoveryDelta) >= 3) whyParts.push(`recovery ${recoveryDelta > 0 ? '+' : ''}${recoveryDelta}% vs your ${baseRecovery}% avg`)
  if (lastHr?.spike_count != null) whyParts.push(`${lastHr.spike_count} HR spikes`)
  if (todayStability != null && baseStability != null) whyParts.push(`stability ${todayStability}/10 (avg ${baseStability})`)
  if (lastHr?.deep_pct != null) whyParts.push(`${lastHr.deep_pct}% deep sleep`)
  const whySentence = whyParts.length ? whyParts.join(' · ') : null

  // ── Build reasoning for each factor ────────────────────────────────────────
  const factors = []

  // Thyroid
  if (thyroxin) {
    factors.push({
      icon: '💊', label: thyroxin.name,
      value: thyroxin.takenTime ? thyroxin.takenTime.slice(0,5) : 'taken',
      signal: thyroxin.fasted ? 'good' : 'warn',
      stat: thyroxin.fasted ? 'Taken fasted' : 'Not fasted',
      reasoning: thyroxin.fasted
        ? 'Good — fasted intake ensures optimal T4 absorption. Thyroid is your most frequent sleep disruptor; proper dosing matters.'
        : 'Should be taken fasted for full effect — poor absorption may contribute to thyroid-related sleep disruption.',
    })
  }

  // Caffeine
  if (lastCaffeine) {
    const halfLivesStr = caffeineHalfLivesAtSleep != null ? `${caffeineHalfLivesAtSleep} half-lives cleared` : null
    const remainingPct = caffeineHalfLivesAtSleep != null ? Math.round(100 / Math.pow(2, caffeineHalfLivesAtSleep)) : null
    factors.push({
      icon: '☕', label: 'Last caffeine',
      value: lastCaffeine.consumed_at?.slice(0,5) || '—',
      signal: caffeineHalfLivesAtSleep >= 2 ? 'neutral' : caffeineHalfLivesAtSleep >= 1 ? 'warn' : 'bad',
      stat: halfLivesStr || lastCaffeine.meal_name,
      reasoning: caffeineHalfLivesAtSleep == null ? null
        : caffeineHalfLivesAtSleep >= 2.5 ? `${remainingPct}% remaining at sleep — minimal impact expected.`
        : caffeineHalfLivesAtSleep >= 1.5 ? `~${remainingPct}% caffeine still active at sleep onset — likely raising your baseline arousal and contributing to the ${lastHr?.spike_count || 'elevated'} HR spikes.`
        : `>50% caffeine still active — significant impact on sleep architecture. Likely a primary driver of disruption tonight.`,
    })
  } else {
    factors.push({ icon: '☕', label: 'Caffeine', value: 'none', signal: 'good', stat: 'No caffeine logged', reasoning: 'Not a factor tonight.' })
  }

  // Alcohol
  if (alcoholMeals?.length > 0) {
    const lastDrink = alcoholMeals[alcoholMeals.length-1]
    factors.push({
      icon: '🍷', label: 'Alcohol',
      value: alcoholMeals.map(m => m.meal_name).join(', '),
      signal: 'bad',
      stat: `Last drink ${lastDrink.consumed_at?.slice(0,5) || '—'}`,
      reasoning: `Alcohol suppresses REM sleep and fragments HR in the first half of the night. This is likely contributing to the ${lastHr?.spike_count || 'elevated'} spikes${lastHr?.rem_pct != null ? ` and reduced REM (${lastHr.rem_pct}%)` : ''}.`,
    })
  }

  // Dinner timing
  if (dinnerMins) {
    const minsLate = avgDinner ? Math.round(dinnerMins - avgDinner) : null
    const dinnerSignal = dinnerMins < 18 * 60 + 30 ? 'good' : dinnerMins > 20 * 60 ? 'warn' : 'neutral'
    factors.push({
      icon: '🍽', label: 'Dinner',
      value: yLog.dinner_time?.slice(0,5),
      signal: dinnerSignal,
      stat: minsLate != null ? `${minsLate > 0 ? '+' : ''}${minsLate}m vs your avg` : null,
      reasoning: dinnerMins > 20 * 60
        ? 'Late dinner — digestion during sleep raises core temperature and increases HR variability. May have contributed to early-night spikes.'
        : dinnerMins < 18 * 60 + 30
        ? 'Early dinner — good timing, digestion well clear of sleep onset.'
        : 'Typical dinner timing — unlikely to be a significant factor.',
    })
  }

  // Wind-down
  if (windDownGap != null) {
    factors.push({
      icon: '📵', label: 'Wind-down gap',
      value: fmtMins(windDownGap),
      signal: windDownGap >= 45 ? 'good' : windDownGap >= 20 ? 'warn' : 'bad',
      stat: avgWindDownGap ? `avg is ${fmtMins(avgWindDownGap)}` : `phone away ${yLog.phone_away_time?.slice(0,5)} → sleep ${(tLog.bed_time || yLog.bed_time)?.slice(0,5)}`,
      reasoning: windDownGap < 20
        ? `Only ${fmtMins(windDownGap)} between phone away and sleep. Very short wind-down means your nervous system had little time to downregulate — likely contributed to slow sleep onset and elevated early HR.`
        : windDownGap < 45
        ? `${fmtMins(windDownGap)} wind-down — moderate. On nights with ≥45m you typically sleep with higher stability.`
        : `${fmtMins(windDownGap)} wind-down — good. Sufficient time to downregulate before sleep.`,
    })
  }

  // Temperature
  if (lastTemp) {
    const tempSignal = optimalTempRange
      ? (lastTemp >= optimalTempRange.min - 1 && lastTemp <= optimalTempRange.max + 1 ? 'good' : 'warn')
      : (lastTemp <= 68 ? 'good' : lastTemp <= 71 ? 'warn' : 'bad')
    factors.push({
      icon: '🌡', label: 'Bedroom temperature',
      value: `${lastTemp}°F avg`,
      signal: tempSignal,
      stat: optimalTempRange ? `your sweet spot: ${optimalTempRange.min}–${optimalTempRange.max}°F` : 'optimal: 65–68°F',
      reasoning: tempSignal === 'good'
        ? `Within your optimal range — temperature not a likely factor tonight.`
        : `${lastTemp}°F is above your optimal range${optimalTempRange ? ` of ${optimalTempRange.min}–${optimalTempRange.max}°F` : ' (65–68°F)'}. A warmer room raises core body temperature and typically increases HR spikes — may be a contributing factor.`,
    })
  }

  // Hydration
  if (water) {
    const waterSignal = water >= 2000 ? 'good' : water >= 1200 ? 'neutral' : 'warn'
    factors.push({
      icon: '💧', label: 'Hydration',
      value: water >= 1000 ? (water/1000).toFixed(1) + 'L' : water + 'ml',
      signal: waterSignal,
      stat: avgWater ? `your avg: ${(avgWater/1000).toFixed(1)}L` : null,
      reasoning: water < 1200
        ? 'Under-hydration can increase RHR and reduce sleep quality. Consider whether this contributed tonight.'
        : water >= 2000
        ? 'Well hydrated — not a factor tonight.'
        : 'Adequate hydration — unlikely to be a factor.',
    })
  }

  // Gut health
  if (poopSummary) {
    factors.push({
      icon: '💩', label: 'Gut health',
      value: `${poopSummary.count}× Type ${poopSummary.types.join('/')}`,
      signal: poopSummary.hasFlags ? 'warn' : poopSummary.types.every(t => t >= 3 && t <= 5) ? 'good' : 'neutral',
      stat: poopSummary.hasFlags ? '⚠️ ' + fmtFlags(poopSummary.flags) : 'normal range',
      reasoning: poopSummary.hasFlags
        ? 'Flags detected — gut inflammation can elevate cortisol and disrupt sleep. Worth monitoring.'
        : poopSummary.types.every(t => t >= 3 && t <= 5)
        ? 'Healthy gut motility — not a likely factor tonight.'
        : 'Irregular stool type may indicate digestive stress.',
    })
  }

  return (
    <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── 1. VERDICT ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: verdictColor }}>{verdictLabel}</div>
          {whySentence && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{whySentence}</div>}
          {baseRecovery && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>7-day avg: {baseRecovery}% recovery{baseStability ? ` · ${baseStability}/10 stability` : ''}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
          {sparkRecovery.some(Boolean) && (
            <div>
              <div style={{ fontSize: 8, color: 'var(--text3)', textAlign: 'right', marginBottom: 2 }}>RECOVERY</div>
              <Sparkline values={sparkRecovery} highlight={sparkRecovery.length - 1} color="var(--green)" />
            </div>
          )}
          {sparkStability.some(Boolean) && (
            <div>
              <div style={{ fontSize: 8, color: 'var(--text3)', textAlign: 'right', marginBottom: 2 }}>STABILITY</div>
              <Sparkline values={sparkStability} highlight={sparkStability.length - 1} color="var(--purple)" />
            </div>
          )}
        </div>
      </div>

      {/* ── 2. HR ANALYSIS ── */}
      {lastHr && (
        <div>
          <SectionLabel>🫀 Heart rate analysis</SectionLabel>
          <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
              {[
                { label: 'Stability', value: lastHr.stability_score, unit: '/10', color: lastHr.stability_score >= 7 ? 'var(--green)' : lastHr.stability_score >= 4 ? 'var(--amber)' : 'var(--red)', delta: stabilityDelta },
                { label: 'Spikes', value: lastHr.spike_count, unit: '', color: lastHr.spike_count > 10 ? 'var(--red)' : lastHr.spike_count > 4 ? 'var(--amber)' : 'var(--green)',
                  note: lastHr.spike_count > 10 ? 'notable (>10)' : lastHr.spike_count > 4 ? 'mildly elevated (5–10)' : 'normal (0–4)' },
                { label: 'Deep', value: lastHr.deep_pct, unit: '%', color: lastHr.deep_pct >= 20 ? 'var(--purple)' : 'var(--amber)' },
                { label: 'HR range', value: lastHr.hr_range, unit: 'bpm', color: lastHr.hr_range > 25 ? 'var(--red)' : lastHr.hr_range > 15 ? 'var(--amber)' : 'var(--green)',
                  note: lastHr.hr_range > 25 ? 'wide (>25)' : lastHr.hr_range > 15 ? 'moderate' : 'normal (<15)' },
              ].filter(m => m.value != null).map(m => (
                <div key={m.label}>
                  <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}{m.unit}</div>
                  {m.note && <div style={{ fontSize: 9, color: m.color, opacity: 0.8, marginTop: 1 }}>{m.note}</div>}
                  {m.delta != null && <div style={{ fontSize: 9, color: m.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>{m.delta >= 0 ? '+' : ''}{m.delta} vs avg</div>}
                </div>
              ))}
            </div>
            {lastHr.likely_cause && lastHr.likely_cause !== 'unclear' && (
              <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>
                  <strong>Likely cause: </strong>
                  {lastHr.likely_cause.charAt(0).toUpperCase() + lastHr.likely_cause.slice(1)}
                  {lastHr.cause_confidence && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> ({lastHr.cause_confidence} confidence)</span>}
                </div>
                {lastHr.cause_reasoning && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{lastHr.cause_reasoning}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3. ROOT CAUSE ANALYSIS ── */}
      <div>
        <SectionLabel>🔬 Last night — root cause analysis</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {factors.map((f, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'start' }}>
                <span style={{ fontSize: 15 }}>{f.icon}</span>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{f.label}</div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: f.signal === 'good' ? 'var(--green)' : f.signal === 'bad' ? 'var(--red)' : f.signal === 'warn' ? 'var(--amber)' : 'var(--text2)' }}>{f.value}</span>
                </div>
              </div>
              {f.stat && <div style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 28, marginTop: 1 }}>{f.stat}</div>}
              {f.reasoning && <div style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 28, marginTop: 4, lineHeight: 1.55, fontStyle: 'italic' }}>{f.reasoning}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. VS RECENT NIGHTS ── */}
      {comparisons.length > 0 && (
        <div>
          <SectionLabel>📊 vs recent nights</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {comparisons.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--surface2)', borderLeft: '3px solid ' + (c.better ? 'var(--green)' : 'var(--red)') }}>
                <span style={{ fontSize: 14 }}>{c.better ? '↑' : '↓'}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
