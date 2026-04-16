import { CLAUDE_MODEL } from '../lib/constants'
import { useState, useEffect } from 'react'
import { format, subDays, startOfWeek, endOfWeek, isMonday } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'

// ─── Pattern computation ───────────────────────────────────────────────────────

function computePatterns(history) {
  if (!history.length) return {}

  const withSleep = history.filter(l => l.sleep_duration > 0)
  const avgSleep = withSleep.length
    ? +(withSleep.reduce((a, l) => a + l.sleep_duration, 0) / withSleep.length).toFixed(1) : null

  // Sauna effect
  const saunaDays = history.filter(l => l.activity?.includes('sauna'))
  const saunaRecoveries = saunaDays.map(l => {
    const next = history.find(n => n.date === format(new Date(new Date(l.date).getTime() + 86400000), 'yyyy-MM-dd'))
    return next?.recovery_score
  }).filter(Boolean)
  const avgSaunaRecovery = saunaRecoveries.length >= 3
    ? Math.round(saunaRecoveries.reduce((a, v) => a + v, 0) / saunaRecoveries.length) : null

  // Non-sauna recovery for comparison
  const nonSaunaDays = history.filter(l => !l.activity?.includes('sauna') && l.recovery_score > 0)
  const avgNonSaunaRecovery = nonSaunaDays.length >= 3
    ? Math.round(nonSaunaDays.reduce((a, l) => a + l.recovery_score, 0) / nonSaunaDays.length) : null

  const saunaLift = avgSaunaRecovery && avgNonSaunaRecovery ? avgSaunaRecovery - avgNonSaunaRecovery : null

  // Gym effect
  const gymDays = history.filter(l => l.activity?.includes('gym'))
  const gymRecoveries = gymDays.map(l => {
    const next = history.find(n => n.date === format(new Date(new Date(l.date).getTime() + 86400000), 'yyyy-MM-dd'))
    return next?.recovery_score
  }).filter(Boolean)
  const avgGymNextRecovery = gymRecoveries.length >= 3
    ? Math.round(gymRecoveries.reduce((a, v) => a + v, 0) / gymRecoveries.length) : null

  // Phone gap effect
  const phoneData = history.filter(l => l.phone_away_time && l.sleep_efficiency)
  const shortGap = phoneData.filter(l => {
    const pm = parseInt(l.phone_away_time.split(':')[0])*60 + parseInt(l.phone_away_time.split(':')[1])
    let bm = l.bed_time ? parseInt(l.bed_time.split(':')[0])*60 + parseInt(l.bed_time.split(':')[1]) : pm + 30
    if (l.bed_time && bm < 360) bm += 1440
    return (bm - pm) < 45
  })
  const longGap = phoneData.filter(l => {
    const pm = parseInt(l.phone_away_time.split(':')[0])*60 + parseInt(l.phone_away_time.split(':')[1])
    let bm = l.bed_time ? parseInt(l.bed_time.split(':')[0])*60 + parseInt(l.bed_time.split(':')[1]) : pm + 30
    if (l.bed_time && bm < 360) bm += 1440
    return (bm - pm) >= 45
  })
  const avgEfficiencyShortGap = shortGap.length >= 3
    ? +(shortGap.reduce((a, l) => a + l.sleep_efficiency, 0) / shortGap.length).toFixed(0) : null
  const avgEfficiencyLongGap = longGap.length >= 3
    ? +(longGap.reduce((a, l) => a + l.sleep_efficiency, 0) / longGap.length).toFixed(0) : null

  // Soreness trend (last 5 days)
  const recentSoreness = history.slice(-5).filter(l => l.morning_soreness > 0)
  const avgSoreness = recentSoreness.length
    ? +(recentSoreness.reduce((a, l) => a + l.morning_soreness, 0) / recentSoreness.length).toFixed(1) : null

  // Weekly training volume
  const thisWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekLogs = history.filter(l => l.date >= thisWeekStart)
  const gymThisWeek = thisWeekLogs.filter(l => l.activity?.includes('gym')).length
  const runThisWeek = thisWeekLogs.filter(l => l.activity?.includes('run')).length

  return {
    avgSleep, avgSaunaRecovery, avgNonSaunaRecovery, saunaLift,
    avgGymNextRecovery, avgEfficiencyShortGap, avgEfficiencyLongGap,
    avgSoreness, gymThisWeek, runThisWeek, daysTracked: history.length,
  }
}

// ─── Generate morning briefing text ───────────────────────────────────────────

async function generateBriefing(todayLog, yesterdayLog, history, settings, lang, sleepHR = []) {
  const patterns = computePatterns(history)

  // Sleep HR context from recent analyses
  const lastHR = sleepHR[0]
  const hrContext = lastHR ? `
SLEEP HR ANALYSIS (last uploaded — ${lastHR.date}):
- Stability score: ${lastHR.stability_score}/10
- Spikes: ${lastHR.spike_count} spikes avg +${lastHR.spike_avg_magnitude}bpm
- Y-axis range: ${lastHR.axis_min}–${lastHR.axis_max}bpm (absolute scale)
- Eye bags that morning: ${lastHR.eye_bag_flag ? 'yes' : 'no'}
- Assessment: ${lastHR.micro_arousal_assessment || 'not assessed'}` : ''
  const today = format(new Date(), 'EEEE d MMM')

  function fmtH(h) {
    if (!h) return '—'
    const hrs = Math.floor(h)
    const mins = Math.round((h - hrs) * 60)
    return hrs === 0 ? `${mins}m` : mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`
  }

  // Recent sleep trend (last 7 days vs prior 7)
  const last7 = history.slice(-7).filter(l => l.sleep_duration)
  const prior7 = history.slice(-14, -7).filter(l => l.sleep_duration)
  const avgLast7Sleep = last7.length ? +(last7.reduce((a, l) => a + l.sleep_duration, 0) / last7.length).toFixed(1) : null
  const avgPrior7Sleep = prior7.length ? +(prior7.reduce((a, l) => a + l.sleep_duration, 0) / prior7.length).toFixed(1) : null
  const sleepTrend = avgLast7Sleep && avgPrior7Sleep ? +(avgLast7Sleep - avgPrior7Sleep).toFixed(1) : null

  // Best sleep in 7 days
  const maxSleepRecent = last7.length ? Math.max(...last7.map(l => l.sleep_duration)) : null
  const isBestSleepInWeek = todayLog?.sleep_duration && maxSleepRecent && todayLog.sleep_duration >= maxSleepRecent

  // Weight trend
  const withWeight = history.filter(l => l.weight).slice(-14)
  const weightChange = withWeight.length >= 2
    ? +(withWeight[withWeight.length-1].weight - withWeight[0].weight).toFixed(1) : null
  const targetWeeklyLoss = settings?.target_weight && settings?.start_weight ? -0.5 : null

  // Yesterday's evening
  const phoneGap = yesterdayLog?.phone_away_time && yesterdayLog?.bed_time
    ? (() => {
        const pm = parseInt(yesterdayLog.phone_away_time.split(':')[0])*60 + parseInt(yesterdayLog.phone_away_time.split(':')[1])
        let bm = parseInt(yesterdayLog.bed_time.split(':')[0])*60 + parseInt(yesterdayLog.bed_time.split(':')[1])
        if (bm < 360) bm += 1440
        return bm - pm
      })() : null

  const context = `
TODAY: ${today}
TODAY'S WHOOP: Recovery ${todayLog?.recovery_score || '—'}%, Sleep ${fmtH(todayLog?.sleep_duration)}, Efficiency ${todayLog?.sleep_efficiency || '—'}%, HRV ${todayLog?.hrv || '—'}ms, RHR ${todayLog?.rhr || '—'}bpm, Restorative ${fmtH(todayLog?.sleep_restorative)}
${isBestSleepInWeek ? '★ Best sleep this week' : ''}

YESTERDAY EVENING:
- Activities: ${yesterdayLog?.activity?.join(', ') || 'none'}
- Habits: ${yesterdayLog?.habits?.join(', ') || 'none'}
- Phone away: ${yesterdayLog?.phone_away_time?.slice(0,5) || 'not logged'}, Sleep onset: ${yesterdayLog?.bed_time?.slice(0,5) || 'not logged'}${yesterdayLog?.bed_time && parseInt(yesterdayLog.bed_time.split(':')[0]) < 6 ? ' (after midnight)' : ''}${phoneGap !== null ? `, Gap: ${phoneGap} minutes (use this number — midnight crossover already handled)` : ''}
- Wind-down: ${yesterdayLog?.wind_down || 'not logged'}
- Calories: ${yesterdayLog?.calories || 'not logged'}

PERSONAL PATTERNS (${patterns.daysTracked} days):
- Sauna → next day recovery: ${patterns.saunaLift ? `+${patterns.saunaLift} pts vs average` : 'insufficient data'} (avg ${patterns.avgSaunaRecovery || '—'}% after sauna vs ${patterns.avgNonSaunaRecovery || '—'}% normally)
- Phone gap <45min → avg efficiency: ${patterns.avgEfficiencyShortGap || '—'}%
- Phone gap ≥45min → avg efficiency: ${patterns.avgEfficiencyLongGap || '—'}%
- Gym → next day avg recovery: ${patterns.avgGymNextRecovery || '—'}%
- Recent soreness trend (5 days): avg ${patterns.avgSoreness || '—'}/5
- Sleep trend (last 7 vs prior 7): ${sleepTrend !== null ? (sleepTrend > 0 ? `+${sleepTrend}h improving` : `${sleepTrend}h declining`) : 'insufficient data'}
- This week: ${patterns.gymThisWeek} gym, ${patterns.runThisWeek} runs
- Weight change (14 days): ${weightChange !== null ? `${weightChange > 0 ? '+' : ''}${weightChange}kg` : 'insufficient data'}${hrContext}`

  const prompt = lang === 'de'
    ? `Du bist Sebastians persönlicher Gesundheitscoach. Schreibe eine KURZE Morgen-Zusammenfassung (max 4 Sätze). Format: "Gestern Abend... → heute Morgen...". Sei direkt und konkret. Nenne ein konkretes Muster wenn relevant. Gib maximal eine Empfehlung für heute.

${context}`
    : `You are Sebastian's personal health coach. Write a SHORT morning briefing (max 4 sentences). Format naturally as "Last night you... → this morning...". Be direct and specific. Name one concrete pattern if relevant. Give at most one recommendation for today. Do not use bullet points — write as natural flowing sentences.

${context}`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ─── Proactive nudges ─────────────────────────────────────────────────────────

function computeNudges(todayLog, yesterdayLog, history, settings, lang, gymGoalPerWeek = 3) {
  const nudges = []
  const hour = new Date().getHours()
  const dayOfWeek = new Date().getDay() // 0=Sun, 1=Mon...

  const patterns = computePatterns(history)

  // Evening nudge: phone timing reminder based on personal data
  if (hour >= 20 && hour < 23 && patterns.avgEfficiencyLongGap && patterns.avgEfficiencyShortGap) {
    const diff = patterns.avgEfficiencyLongGap - patterns.avgEfficiencyShortGap
    if (diff >= 3) {
      nudges.push({
        type: 'phone',
        icon: '📵',
        color: 'var(--blue)',
        bg: 'rgba(26,92,158,0.07)',
        text: lang === 'de'
          ? `Deine Daten zeigen: Handy ≥45min vor dem Schlafen → ${diff}% bessere Schlafeffizienz. Jetzt wäre ein guter Zeitpunkt.`
          : `Your data shows: phone away ≥45min before bed → ${diff}% better sleep efficiency. Now would be a good time.`
      })
    }
  }

  // Weekly gym goal nudge
  if (hour >= 9 && dayOfWeek >= 4) { // Thu, Fri, Sat
    if (patterns.gymThisWeek < gymGoalPerWeek) {
      const remaining = gymGoalPerWeek - patterns.gymThisWeek
      const daysLeft = 7 - dayOfWeek
      nudges.push({
        type: 'gym',
        icon: '🏋️',
        color: 'var(--amber)',
        bg: 'rgba(186,117,23,0.07)',
        text: lang === 'de'
          ? `${remaining} Gym-Einheit${remaining > 1 ? 'en' : ''} noch diese Woche — noch ${daysLeft} Tag${daysLeft > 1 ? 'e' : ''} übrig.`
          : `${remaining} gym session${remaining > 1 ? 's' : ''} still needed this week — ${daysLeft} day${daysLeft > 1 ? 's' : ''} left.`
      })
    }
  }

  // Soreness warning
  if (patterns.avgSoreness >= 3.5 && hour < 14) {
    nudges.push({
      type: 'soreness',
      icon: '⚠️',
      color: 'var(--amber)',
      bg: 'rgba(186,117,23,0.07)',
      text: lang === 'de'
        ? `Muskelkater-Durchschnitt dieser Woche: ${patterns.avgSoreness}/5. Heute könnte ein guter Erholungstag sein.`
        : `Soreness averaging ${patterns.avgSoreness}/5 this week. Today might be a good recovery day.`
    })
  }

  // Weight trend nudge (weekly on Monday)
  if (dayOfWeek === 1 && hour < 14 && settings?.target_weight) {
    const withWeight = history.filter(l => l.weight).slice(-7)
    if (withWeight.length >= 2) {
      const weeklyChange = +(withWeight[withWeight.length-1].weight - withWeight[0].weight).toFixed(1)
      const target = -0.5
      if (weeklyChange > target + 0.2) {
        nudges.push({
          type: 'weight',
          icon: '⚖️',
          color: 'var(--red)',
          bg: 'rgba(194,48,48,0.07)',
          text: lang === 'de'
            ? `Wochenrückblick: ${weeklyChange > 0 ? '+' : ''}${weeklyChange}kg diese Woche. Ziel war -0,5kg — prüfe Kalorien oder Aktivität.`
            : `Weekly check: ${weeklyChange > 0 ? '+' : ''}${weeklyChange}kg this week. Target was -0.5kg — review calories or activity.`
        })
      } else if (weeklyChange <= target) {
        nudges.push({
          type: 'weight',
          icon: '⚖️',
          color: 'var(--green)',
          bg: 'rgba(26,122,94,0.07)',
          text: lang === 'de'
            ? `Wochenrückblick: ${weeklyChange}kg diese Woche. Genau auf Kurs für dein Ziel.`
            : `Weekly check: ${weeklyChange}kg this week. Right on track for your goal.`
        })
      }
    }
  }

  return nudges.slice(0, 2) // max 2 nudges at once
}

// ─── Morning Briefing Card ────────────────────────────────────────────────────

export function MorningBriefing({ session, todayLog, settings }) {
  const { lang } = useLang()
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const hour = new Date().getHours()

  useEffect(() => {
    // Don't generate outside morning hours
    if (hour >= 13 || dismissed) { setLoading(false); return }
    if (todayLog?.ai_briefing) {
      setBriefing(todayLog.ai_briefing)
      setLoading(false)
      return
    }
    if (!todayLog?.recovery_score && !todayLog?.sleep_duration) {
      setLoading(false)
      return
    }
    generateAndSave()
  }, [todayLog?.recovery_score, todayLog?.sleep_duration, dismissed])

  async function generateAndSave() {
    setLoading(true)
    try {
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
      const today = format(new Date(), 'yyyy-MM-dd')

      const [{ data: yesterdayLog }, { data: history }, { data: sleepHR }] = await Promise.all([
        supabase.from('daily_logs').select('*').eq('user_id', session.user.id).eq('date', yesterday).maybeSingle(),
        supabase.from('daily_logs').select('*').eq('user_id', session.user.id).gte('date', thirtyDaysAgo).lt('date', today).order('date'),
        supabase.from('sleep_hr_analysis').select('*').eq('user_id', session.user.id).order('date', { ascending: false }).limit(7),
      ])

      const text = await generateBriefing(todayLog, yesterdayLog, history || [], settings, lang, sleepHR || [])
      setBriefing(text)

      // Save to today's log
      await supabase.from('daily_logs').upsert({
        user_id: session.user.id, date: today,
        ai_briefing: text, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })
    } catch (e) {
      console.error('Briefing failed:', e)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ margin: '0 0 0 0', padding: '12px 14px', background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="spinner" style={{ width: 16, height: 16, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          {lang === 'de' ? 'Morgen-Analyse wird erstellt...' : 'Generating morning briefing...'}
        </span>
      </div>
    )
  }

  if (!briefing) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(26,122,94,0.06), rgba(26,122,94,0.02))',
      border: '0.5px solid var(--green-border)',
      borderRadius: 14, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flex: 1 }}>
          <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>🌅</span>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65 }}>{briefing}</div>
        </div>
        <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, padding: 0, flexShrink: 0, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1l1 2 2.5.3-1.8 1.7.4 2.4L5 6.3l-2.1 1.1.4-2.4L1.5 3.3 4 3 5 1z" stroke="var(--text3)" strokeWidth="0.8" strokeLinejoin="round"/></svg>
        {lang === 'de' ? 'KI-Analyse · generiert heute Morgen' : 'AI analysis · generated this morning'}
      </div>
    </div>
  )
}

// ─── Proactive Nudges ─────────────────────────────────────────────────────────

export function ProactiveNudges({ session, todayLog, settings }) {
  const { lang } = useLang()
  const [nudges, setNudges] = useState([])
  const [dismissed, setDismissed] = useState(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
      const [{ data: history }, { data: yesterdayLog }, { data: gymGoal }] = await Promise.all([
        supabase.from('daily_logs').select('*').eq('user_id', session.user.id).gte('date', thirtyDaysAgo).order('date'),
        supabase.from('daily_logs').select('*').eq('user_id', session.user.id).eq('date', yesterday).maybeSingle(),
        supabase.from('goals').select('target_value').eq('user_id', session.user.id).ilike('name', '%gym%').eq('timeframe', 'week').maybeSingle(),
      ])
      const gymGoalPerWeek = gymGoal?.target_value || 3
      const computed = computeNudges(todayLog, yesterdayLog, history || [], settings, lang, gymGoalPerWeek)
      setNudges(computed)
      setLoaded(true)
    }
    load()
  }, [session.user.id, lang])

  const visible = nudges.filter(n => !dismissed.has(n.type))
  if (!loaded || visible.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {visible.map(nudge => (
        <div key={nudge.type} style={{
          background: nudge.bg,
          border: `0.5px solid ${nudge.color}40`,
          borderRadius: 12, padding: '10px 12px',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{nudge.icon}</span>
          <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55, flex: 1 }}>{nudge.text}</span>
          <button onClick={() => setDismissed(d => new Set([...d, nudge.type]))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, padding: 0, flexShrink: 0 }}>×</button>
        </div>
      ))}
    </div>
  )
}
