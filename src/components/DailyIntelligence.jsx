import { CLAUDE_MODEL, CAFFEINE_REGEX } from '../lib/constants'
import { compressImage } from '../lib/imageUtils'
import { useState, useEffect, useRef } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'
import SleepPatterns from './SleepPatterns'
import SleepDeepDive from './SleepDeepDive'

// ─── AI Analysis Engine ───────────────────────────────────────────────────────

async function generateDailyInsight(todayLog, yesterdayLog, historicalLogs, lang, yesterdayEvents, todayEvents, travelState, caffeineMeals = [], hrContext = '', alcoholMeals = []) {
  // Pattern analysis from historical data
  const phoneDelays = historicalLogs
    .filter(l => l.phone_away_time && l.sleep_efficiency)
    .map(l => {
      const phoneMin = parseInt(l.phone_away_time?.split(':')[0]) * 60 + parseInt(l.phone_away_time?.split(':')[1] || 0)
      let bedMin = l.bed_time ? parseInt(l.bed_time?.split(':')[0]) * 60 + parseInt(l.bed_time?.split(':')[1] || 0) : null
      // Handle midnight crossover: if bed time is before 6am it's after midnight
      if (bedMin !== null && bedMin < 360) bedMin += 1440
      return { gap: bedMin ? bedMin - phoneMin : null, efficiency: l.sleep_efficiency, recovery: l.recovery_score }
    }).filter(d => d.gap !== null && d.gap > 0)

  const avgGapShort = phoneDelays.filter(d => d.gap < 45).length
    ? +(phoneDelays.filter(d => d.gap < 45).reduce((a, d) => a + d.efficiency, 0) / phoneDelays.filter(d => d.gap < 45).length).toFixed(0) : null
  const avgGapLong = phoneDelays.filter(d => d.gap >= 45).length
    ? +(phoneDelays.filter(d => d.gap >= 45).reduce((a, d) => a + d.efficiency, 0) / phoneDelays.filter(d => d.gap >= 45).length).toFixed(0) : null

  const activityEffect = (activity) => {
    const days = historicalLogs.filter(l => l.activity?.some(a => a.includes(activity)))
    const recoveries = days.map(l => {
      const next = historicalLogs.find(n => n.date === format(new Date(new Date(l.date).getTime() + 86400000), 'yyyy-MM-dd'))
      return next?.recovery_score
    }).filter(Boolean)
    return recoveries.length ? Math.round(recoveries.reduce((a, v) => a + v, 0) / recoveries.length) : null
  }

  const habitEffect = (habit) => {
    const withHabit = historicalLogs.filter(l => l.habits?.some(h => h.includes(habit)))
    const nextDayRecovery = withHabit.map(l => {
      const next = historicalLogs.find(n => n.date === format(new Date(new Date(l.date).getTime() + 86400000), 'yyyy-MM-dd'))
      return next?.recovery_score
    }).filter(Boolean)
    return nextDayRecovery.length >= 3 ? Math.round(nextDayRecovery.reduce((a, v) => a + v, 0) / nextDayRecovery.length) : null
  }

  const meditationEffect = habitEffect('meditation')
  const readingEffect = habitEffect('reading')

  const patternContext = `
SEBASTIAN'S PERSONAL PATTERNS (${historicalLogs.length} days of data):
- Phone away <45min before bed → avg sleep efficiency: ${avgGapShort ? avgGapShort + '%' : 'insufficient data'}
- Phone away ≥45min before bed → avg sleep efficiency: ${avgGapLong ? avgGapLong + '%' : 'insufficient data'}
- Day after gym → avg recovery: ${activityEffect('gym') ? activityEffect('gym') + '%' : 'insufficient data'}
- Day after sauna → avg recovery: ${activityEffect('sauna') ? activityEffect('sauna') + '%' : 'insufficient data'}
- Day after run → avg recovery: ${activityEffect('run') ? activityEffect('run') + '%' : 'insufficient data'}
- Nights with meditation → next day avg recovery: ${meditationEffect ? meditationEffect + '%' : 'insufficient data'}
- Nights with reading → next day avg recovery: ${readingEffect ? readingEffect + '%' : 'insufficient data'}
`

  const yesterdayDate = yesterdayLog ? format(new Date(yesterdayLog.date), 'd MMM') : 'yesterday'
  const caffeineContext = caffeineMeals.length
    ? '\n- Caffeine: ' + caffeineMeals.map(m => m.meal_name + (m.consumed_at ? ' at ' + m.consumed_at.slice(0,5) + ' (50% cleared ~' + String((parseInt(m.consumed_at.split(':')[0])+5)%24).padStart(2,'0') + ':' + m.consumed_at.slice(3,5) + ')' : '')).join(', ')
    : '\n- Caffeine: none logged'

  const alcoholContext = alcoholMeals.length
    ? '\n- Alcohol: ' + alcoholMeals.map(m => m.meal_name + (m.consumed_at ? ' at ' + m.consumed_at.slice(0,5) : '')).join(', ') + ' — alcohol significantly fragments sleep, suppresses REM, raises RHR'
    : '\n- Alcohol: none logged'

  const eventsContext = yesterdayEvents?.length
    ? `\n- Special events yesterday: ${yesterdayEvents.map(e => e.label).join(', ')}`
    : ''
  const travelContext = travelState?.active
    ? `\n- CURRENTLY TRAVELLING: ${travelState.label}, day ${Math.max(1, Math.floor((new Date() - new Date(travelState.departure_date)) / 86400000))} of trip, ${travelState.timezone_offset > 0 ? '+' : ''}${travelState.timezone_offset}h time difference — jet lag is a likely factor in sleep/recovery metrics`
    : ''

  const yesterdayContext = yesterdayLog ? `
EVENING OF ${yesterdayDate} (what happened before this sleep):
- Activities: ${yesterdayLog.activity?.join(', ') || 'none logged'}
- Evening habits completed: ${yesterdayLog.habits?.join(', ') || 'none logged'}
- Got home at: ${yesterdayLog.home_time?.slice(0,5) || 'not logged'}
- Dinner finished at: ${yesterdayLog.dinner_time?.slice(0,5) || 'not logged'}
- Phone away at: ${yesterdayLog.phone_away_time?.slice(0,5) || 'not logged'}
- Sleep onset: ${yesterdayLog.bed_time?.slice(0,5) || 'not logged'}${yesterdayLog.bed_time && parseInt(yesterdayLog.bed_time.split(':')[0]) < 6 ? ' (after midnight — next calendar day)' : ''}
- Phone-to-sleep gap: ${yesterdayLog.phone_away_time && yesterdayLog.bed_time
    ? (() => {
        const pm = parseInt(yesterdayLog.phone_away_time.split(':')[0])*60 + parseInt(yesterdayLog.phone_away_time.split(':')[1])
        let bm = parseInt(yesterdayLog.bed_time.split(':')[0])*60 + parseInt(yesterdayLog.bed_time.split(':')[1])
        if (bm < 360) bm += 1440
        const gap = bm - pm
        return gap + ' minutes (DO NOT recalculate — midnight crossover already handled)'
      })()
    : 'not calculable'}
- Home-to-phone gap: ${yesterdayLog.home_time && yesterdayLog.phone_away_time
    ? (() => {
        const hm = parseInt(yesterdayLog.home_time.split(':')[0])*60 + parseInt(yesterdayLog.home_time.split(':')[1])
        const pm = parseInt(yesterdayLog.phone_away_time.split(':')[0])*60 + parseInt(yesterdayLog.phone_away_time.split(':')[1])
        return (pm - hm) + ' minutes between arriving home and putting phone away'
      })()
    : 'not calculable'}
- Wind-down quality: ${yesterdayLog.wind_down || 'not logged'}
- AC temperature: ${yesterdayLog.ac_temp ? yesterdayLog.ac_temp + '°F' : 'not logged'}
- Calories: ${yesterdayLog.calories ? yesterdayLog.calories + ' kcal' : 'not logged'}
- Water: ${yesterdayLog.water ? yesterdayLog.water + 'ml' : 'not logged'}
- Steps: ${yesterdayLog.steps ? yesterdayLog.steps.toLocaleString() : 'not logged'}
- Evening note: ${yesterdayLog.evening_note || 'none'}${eventsContext}${caffeineContext}${alcoholContext}${travelContext}
` : 'No evening log for yesterday'

  const todayContext = `
THIS MORNING (${format(new Date(), 'd MMM')} — result of that sleep):
- Recovery: ${todayLog.recovery_score ? todayLog.recovery_score + '%' : 'not synced'}
- Sleep duration: ${todayLog.sleep_duration ? todayLog.sleep_duration.toFixed(1) + 'h' : 'not synced'}
- Sleep efficiency: ${todayLog.sleep_efficiency ? todayLog.sleep_efficiency + '%' : 'not synced'}
- HRV: ${todayLog.hrv ? todayLog.hrv + 'ms' : 'not synced'}
- RHR: ${todayLog.rhr ? todayLog.rhr + 'bpm' : 'not synced'}
- Restorative sleep: ${todayLog.sleep_restorative ? todayLog.sleep_restorative.toFixed(1) + 'h' : 'not synced'}
- Sleep onset (from WHOOP screenshot): ${todayLog.bed_time?.slice(0,5) || 'not uploaded yet'}
- Morning check-in (only use if logged today): Energy ${todayLog.morning_energy > 0 ? todayLog.morning_energy + '/5' : 'NOT logged yet — do not guess'}, Mood ${todayLog.morning_mood > 0 ? todayLog.morning_mood + '/5' : 'NOT logged yet'}, Soreness ${todayLog.morning_soreness > 0 ? todayLog.morning_soreness + '/5' : 'NOT logged yet'}
- Morning note: ${todayLog.morning_note || 'none'}
`

  const prompt = lang === 'de'
    ? `Du bist Sebastians persönlicher Gesundheitscoach. Du analysierst die Verbindung zwischen dem gestrigen Abend und dem heutigen Morgen — das ist der Kern-Analyse.

${patternContext}
${yesterdayContext}
${todayContext}

Schreibe 3-5 direkte Sätze. Verbinde konkret was gestern Abend passierte mit dem heutigen WHOOP-Ergebnis. Nutze seine persönlichen Muster wenn relevant. Stelle eine smarte Folgefrage. Sei wie ein erfahrener Coach — direkt, ehrlich, nicht übermäßig positiv.`
    : `You are Sebastian's personal health coach. You are analysing the connection between last evening and this morning — this is the core insight.

${patternContext}
${yesterdayContext}
${todayContext}
${hrContext}

Write a holistic 4-5 sentence narrative synthesising everything. Weave together: last evening context, sleep HR analysis (if available — include the likely cause and what it means), WHOOP metrics, and morning check-in (only if actually logged). Connect causes to effects. Reference personal patterns. End with one smart specific question. No tables, no bullets — pure narrative. Be direct and honest like a coach who knows him well.`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ─── WHOOP Screenshot Upload (inline in morning) ──────────────────────────────

function WhoopUpload({ session, date, lang, bedTime, onDone, onRefetchHr }) {
  const fileRef = useRef()
  const [analysing, setAnalysing] = useState(false)
  const [done, setDone] = useState(!!bedTime)

  // Sync from prop, but never go from done→not-done unless user explicitly re-uploads
  useEffect(() => { if (bedTime) setDone(true) }, [bedTime])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAnalysing(true)
    try {
      const { base64 } = await compressImage(file)

      // Call proxy
      const prompt = `You are a sleep medicine expert. Analyse this WHOOP sleep screenshot for ${date}. Extract all visible data. Respond ONLY with valid JSON.

CRITICAL — all times must be in 24-hour format (HH:MM):
- "10:27 PM" → "22:27"
- "12:03 AM" → "00:03" (12:xx AM is midnight/after-midnight, NOT noon)
- "6:45 AM" → "06:45"
- "12:30 PM" → "12:30" (noon)
Sleep onset is typically 22:xx-23:xx or 00:xx-02:xx. Wake time is typically 06:xx-09:xx.

{"sleep_onset":"HH:MM or null","wake_time":"HH:MM or null","sleep_duration_h":number or null,"awake_pct":number or null,"light_pct":number or null,"deep_pct":number or null,"rem_pct":number or null,"hr_baseline":number or null,"hr_min":number or null,"hr_max":number or null,"hr_range":number or null,"axis_min":number or null,"axis_max":number or null,"spike_count":number or null,"spike_avg_magnitude":number or null,"spike_max_magnitude":number or null,"stable_pct":number or null,"fragmented_pct":number or null,"stability_score":number or null,"likely_cause":"thyroid|stress|apnea|temperature|food|caffeine|mixed|unclear","cause_confidence":"low|medium|high","cause_reasoning":"1-2 sentences","micro_arousals_likely":true or false,"micro_arousal_count":number or null,"analysis":"3-4 sentences","eye_bag_risk":"low|medium|high","recommendation":"one sentence"}`
      const r = await fetch('/.netlify/functions/claude-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } }, { type: 'text', text: prompt }] }] })
      })
      const data = await r.json()
      const result = JSON.parse(data.content?.[0]?.text?.replace(/```json|```/g, '').trim() || '{}')

      // Save analysis — only insert columns that exist in the table
      const hrPayload = {
        user_id: session.user.id,
        date,
        screenshot_path: null,
        sleep_onset: result.sleep_onset || null,
        wake_time: result.wake_time || null,
        sleep_duration_h: result.sleep_duration_h || null,
        awake_pct: result.awake_pct || null,
        light_pct: result.light_pct || null,
        deep_pct: result.deep_pct || null,
        rem_pct: result.rem_pct || null,
        hr_baseline: result.hr_baseline || null,
        hr_min: result.hr_min || null,
        hr_max: result.hr_max || null,
        hr_range: result.hr_range || null,
        axis_min: result.axis_min || null,
        axis_max: result.axis_max || null,
        spike_count: result.spike_count ?? null,
        spike_avg_magnitude: result.spike_avg_magnitude || null,
        spike_max_magnitude: result.spike_max_magnitude || null,
        stable_pct: result.stable_pct || null,
        stability_score: result.stability_score || null,
        likely_cause: result.likely_cause || null,
        cause_confidence: result.cause_confidence || null,
        cause_reasoning: result.cause_reasoning || null,
        micro_arousals_likely: result.micro_arousals_likely ?? null,
        micro_arousal_count: result.micro_arousal_count ?? null,
        analysis: result.analysis || null,
        eye_bag_risk: result.eye_bag_risk || null,
        recommendation: result.recommendation || null,
      }
      const { error: hrError } = await supabase.from('sleep_hr_analysis').upsert(hrPayload, { onConflict: 'user_id,date' })

      // Save bed_time to daily_logs
      if (result.sleep_onset) {
        // Correct common 12h→24h mistake: "12:03" from "12:03 AM" should be "00:03"
        // Sleep onset is never noon — if it's 12:xx, it's almost certainly midnight (00:xx)
        let correctedOnset = result.sleep_onset
        const [h] = correctedOnset.split(':').map(Number)
        if (h === 12) correctedOnset = '00:' + correctedOnset.slice(3)
        await supabase.from('daily_logs').upsert({ user_id: session.user.id, date, bed_time: correctedOnset, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' })
        result.sleep_onset = correctedOnset
      }

      setDone(true)
      if (onRefetchHr) onRefetchHr()

      // Fetch overnight temperature readings from phone_away_time → now
      try {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().slice(0, 10)
        // Get phone_away_time from yesterday's log to anchor the window
        const { data: yLog } = await supabase.from('daily_logs').select('phone_away_time,home_time').eq('user_id', session.user.id).eq('date', yesterdayStr).maybeSingle()
        const phoneAway = yLog?.phone_away_time || yLog?.home_time
        const windowStart = phoneAway
          ? new Date(`${yesterdayStr}T${phoneAway}`).toISOString()
          : new Date(yesterday.setHours(21, 0, 0, 0)).toISOString()

        const { data: tempReadings } = await supabase.from('temperature_readings')
          .select('recorded_at, temperature_c, temperature_f, humidity')
          .gte('recorded_at', windowStart)
          .lte('recorded_at', new Date().toISOString())
          .order('recorded_at', { ascending: true })

        if (tempReadings?.length >= 2) {
          const temps = tempReadings.map(r => r.temperature_f)
          const avgTempF = +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)
          const minTempF = +Math.min(...temps).toFixed(1)
          const maxTempF = +Math.max(...temps).toFixed(1)
          const avgHumidity = +(tempReadings.map(r => r.humidity).reduce((a, b) => a + b, 0) / tempReadings.length).toFixed(0)
          // Store summary + full curve JSON in sleep_hr_analysis
          await supabase.from('sleep_hr_analysis').upsert({
            user_id: session.user.id,
            date,
            temp_avg_f: avgTempF,
            temp_min_f: minTempF,
            temp_max_f: maxTempF,
            temp_avg_c: +((avgTempF - 32) * 5/9).toFixed(1),
            humidity_avg: avgHumidity,
            temp_curve: JSON.stringify(tempReadings.map(r => ({ t: r.recorded_at, f: r.temperature_f, c: r.temperature_c }))),
          }, { onConflict: 'user_id,date' })
          // Also update ac_temp in daily_logs with actual measured average
          await supabase.from('daily_logs').upsert({ user_id: session.user.id, date, ac_temp: avgTempF, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' })
        }
      } catch (tempErr) {
        console.warn('Temperature fetch failed (non-critical):', tempErr.message)
      }

      if (onDone) await onDone({ bed_time: result.sleep_onset || null })
      showToast(lang === 'de' ? 'Analysiert' + (result.sleep_onset ? ' · Einschlafzeit ' + result.sleep_onset : '') : 'Analysed' + (result.sleep_onset ? ' · Sleep onset ' + result.sleep_onset : ''))
    } catch (err) {
      console.error(err)
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setAnalysing(false)
  }

  if (done) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--green-light)', borderRadius: 8 }}>
      <span style={{ fontSize: 14 }}>✅</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
          {lang === 'de' ? 'WHOOP Screenshot analysiert' : 'WHOOP screenshot analysed'}
          {bedTime && ` · 🛏 ${bedTime}`}
        </div>
        <button onClick={() => { setDone(false) }} style={{ fontSize: 10, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', opacity: 0.7 }}>
          {lang === 'de' ? '↺ Neu hochladen' : '↺ Re-upload'}
        </button>
      </div>
    </div>
  )

  if (analysing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8 }}>
      <div className="spinner" style={{ width: 16, height: 16, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{lang === 'de' ? 'Analysiere...' : 'Analysing screenshot...'}</span>
    </div>
  )

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      <button onClick={() => fileRef.current?.click()} style={{
        width: '100%', padding: '10px', borderRadius: 8, border: '1.5px dashed var(--border)',
        background: 'none', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>📸</span>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {lang === 'de' ? 'WHOOP Screenshot hochladen' : 'Upload WHOOP screenshot'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            {lang === 'de' ? 'Einschlafzeit + Schlafphasen werden automatisch extrahiert' : 'Sleep onset + stages auto-extracted'}
          </div>
        </div>
      </button>
    </div>
  )
}

// ─── Morning Check-in ─────────────────────────────────────────────────────────

function MorningCheckin({ log, onSave, lang, yesterdayLog, session, date }) {
  const [energy, setEnergy] = useState(log?.morning_energy || 0)
  const [mood, setMood] = useState(log?.morning_mood || 0)
  const [soreness, setSoreness] = useState(log?.morning_soreness || 0)
  const [note, setNote] = useState(log?.morning_note || '')
  const [saving, setSaving] = useState(false)

  // Re-sync when log fields change
  useEffect(() => {
    setEnergy(log?.morning_energy || 0)
    setMood(log?.morning_mood || 0)
    setSoreness(log?.morning_soreness || 0)
    setNote(log?.morning_note || '')
  }, [log?.morning_energy, log?.morning_mood, log?.morning_soreness, log?.morning_note, log?.bed_time])

  const emojis = {
    energy: ['', '😴', '😑', '😐', '🙂', '⚡'],
    mood: ['', '😞', '😕', '😐', '😊', '😄'],
    soreness: ['', '🔴', '🟠', '🟡', '🟢', '✅'],
  }

  const labels = lang === 'de'
    ? { energy: 'Energie', mood: 'Stimmung', soreness: 'Muskelkater', placeholder: 'Etwas Besonderes?', save: 'Check-in speichern', saving: 'Speichern...' }
    : { energy: 'Energy', mood: 'Mood', soreness: 'Soreness', placeholder: 'Anything specific?', save: 'Save check-in', saving: 'Saving...' }

  async function handleSave() {
    setSaving(true)
    await onSave({ morning_energy: energy, morning_mood: mood, morning_soreness: soreness, morning_note: note || null })
    setSaving(false)
    showToast(lang === 'de' ? 'Check-in gespeichert' : 'Check-in saved')
  }

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* WHOOP screenshot upload — data collection */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          {lang === 'de' ? '📸 WHOOP Screenshot' : '📸 WHOOP screenshot'}
        </div>
        <WhoopUpload session={session} date={date} lang={lang} bedTime={log?.bed_time || ''} onRefetchHr={() => {}} onDone={onSave} />
      </div>

      <div style={{ height: 0, borderTop: '0.5px solid var(--border)' }} />

      {/* Morning subjective check-in */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {lang === 'de' ? '🌅 Morgen-Check-in' : '🌅 Morning check-in'}
      </div>

      {[
        { label: labels.energy, val: energy, set: setEnergy, key: 'energy' },
        { label: labels.mood, val: mood, set: setMood, key: 'mood' },
        { label: labels.soreness, val: soreness, set: setSoreness, key: 'soreness' },
      ].map(item => (
        <div key={item.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{item.label}</span>
            <span style={{ fontSize: 16 }}>{item.val > 0 ? emojis[item.key][item.val] : '—'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} onClick={() => item.set(v)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8,
                border: `1.5px solid ${item.val === v ? 'var(--green)' : 'var(--border)'}`,
                background: item.val === v ? 'var(--green-light)' : 'var(--surface2)',
                color: item.val === v ? 'var(--green)' : 'var(--text2)',
                fontWeight: item.val === v ? 700 : 400, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit'
              }}>{v}</button>
            ))}
          </div>
        </div>
      ))}

      <input className="field-input" value={note} onChange={e => setNote(e.target.value)} placeholder={labels.placeholder} style={{ fontSize: 13 }} />

      <button className="btn-primary" onClick={handleSave} disabled={saving || !energy || !mood || !soreness}>
        {saving ? labels.saving : labels.save}
      </button>
    </div>
  )
}

// ─── Evening Log (merged with habits) ────────────────────────────────────────

export function EveningLog({ log, onSave, lang, habitGoals, activeHabits, onToggleHabit }) {
  const [phoneAway, setPhoneAway] = useState(log?.phone_away_time?.slice(0,5) || '')
  const [homeTime, setHomeTime] = useState(log?.home_time?.slice(0,5) || '')
  const homeRef = useRef(null)
  const [windDown, setWindDown] = useState(log?.wind_down || '')
  const [note, setNote] = useState(log?.evening_note || '')
  const phoneRef = useRef(null)
  const [saving, setSaving] = useState(false)

  // Re-sync when log fields change
  useEffect(() => {
    const phone = log?.phone_away_time?.slice(0,5) || ''
    const home = log?.home_time?.slice(0,5) || ''
    setPhoneAway(phone)
    setHomeTime(home)
    setWindDown(log?.wind_down || '')
    setNote(log?.evening_note || '')
    if (phoneRef.current) phoneRef.current.value = phone
    if (homeRef.current) homeRef.current.value = home
  }, [log?.phone_away_time, log?.home_time, log?.wind_down, log?.evening_note])

  const labels = lang === 'de'
    ? { habits: 'Abendgewohnheiten', phone: 'Handy weggelegt um', wind: 'Abend-Qualität', note: 'Etwas Besonderes?', save: 'Abend speichern', saving: 'Speichern...', good: 'Gut', ok: 'OK', poor: 'Schlecht' }
    : { habits: 'Evening habits', phone: 'Phone away at', wind: 'Wind-down quality', note: 'Anything affect your evening?', save: 'Save evening', saving: 'Saving...', good: 'Good', ok: 'OK', poor: 'Poor' }

  async function handleSave() {
    // Capture current input values from both ref (DOM) and state (onBlur)
    const phoneVal = phoneRef.current?.value || phoneAway || null
    setSaving(true)
    await onSave({
      phone_away_time: phoneVal || null,
      home_time: homeRef.current?.value || homeTime || null,
      wind_down: windDown || null,
      evening_note: note || null,
    })
    setSaving(false)
    showToast(lang === 'de' ? 'Abend gespeichert' : 'Evening saved')
  }

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Habit toggles — merged from standalone card */}
      {habitGoals.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{labels.habits}</div>
          <div className="toggle-grid">
            {habitGoals.map(h => {
              const key = h.name.toLowerCase().replace(/\s+/g, '_')
              const emoji = h.emoji || ''
              return (
                <button key={key} className={`toggle-btn ${activeHabits.has(key) ? 'active' : ''}`} onClick={() => onToggleHabit(key)}>
                  {emoji} {h.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Evening time fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Got home at */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => {
            if (!homeTime) {
              const now = format(new Date(), 'HH:mm')
              setHomeTime(now)
              if (homeRef.current) homeRef.current.value = now
              onSave({ home_time: now })
            } else {
              setHomeTime('')
              if (homeRef.current) homeRef.current.value = ''
              onSave({ home_time: null })
            }
          }} style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            border: `1.5px solid ${homeTime ? 'var(--blue)' : 'var(--border)'}`,
            background: homeTime ? 'rgba(26,92,158,0.12)' : 'var(--surface2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}>
            {homeTime && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-6" stroke="var(--blue)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: homeTime ? 'var(--text)' : 'var(--text2)' }}>
            🏠 {lang === 'de' ? 'Zuhause angekommen' : 'Got home at'}
          </span>
          {homeTime && (
            <input ref={homeRef} type="time" defaultValue={homeTime}
              onChange={e => setHomeTime(e.target.value)}
              onBlur={() => {
                const v = homeRef.current?.value
                if (v) { setHomeTime(v); onSave({ home_time: v }) }
              }}
              style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--blue)', background: 'none', border: 'none', outline: 'none', width: 80, textAlign: 'right', cursor: 'pointer' }}
            />
          )}
        </div>

        {/* Phone away */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => {
            if (!phoneAway) {
              const now = format(new Date(), 'HH:mm')
              setPhoneAway(now)
              if (phoneRef.current) phoneRef.current.value = now
              onSave({ phone_away_time: now })
            } else {
              setPhoneAway('')
              if (phoneRef.current) phoneRef.current.value = ''
              onSave({ phone_away_time: null })
            }
          }} style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            border: `1.5px solid ${phoneAway ? 'var(--green)' : 'var(--border)'}`,
            background: phoneAway ? 'var(--green)' : 'var(--surface2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}>
            {phoneAway && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: phoneAway ? 'var(--text)' : 'var(--text2)' }}>
            📵 {labels.phone}
          </span>
          {phoneAway && (
            <input ref={phoneRef} type="time" defaultValue={phoneAway}
              onChange={e => setPhoneAway(e.target.value)}
              onBlur={() => {
                const v = phoneRef.current?.value
                if (v) { setPhoneAway(v); onSave({ phone_away_time: v }) }
              }}
              style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)', background: 'none', border: 'none', outline: 'none', width: 80, textAlign: 'right', cursor: 'pointer' }}
            />
          )}
        </div>

      </div>

      {/* Wind-down quality */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{labels.wind}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['good', labels.good, '😌'], ['ok', labels.ok, '😐'], ['poor', labels.poor, '😣']].map(([val, label, emoji]) => (
            <button key={val} onClick={() => setWindDown(v => v === val ? '' : val)} style={{
              flex: 1, padding: '9px', borderRadius: 8,
              border: `1.5px solid ${windDown === val ? 'var(--green)' : 'var(--border)'}`,
              background: windDown === val ? 'var(--green-light)' : 'var(--surface2)',
              color: windDown === val ? 'var(--green)' : 'var(--text2)',
              fontWeight: windDown === val ? 700 : 400, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
            }}>{emoji} {label}</button>
          ))}
        </div>
      </div>

      <input className="field-input" value={note} onChange={e => setNote(e.target.value)} placeholder={labels.note} style={{ fontSize: 13 }} />

      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? labels.saving : labels.save}
      </button>
    </div>
  )
}

// ─── WHOOP Tab (upload + last night summary) ──────────────────────────────────


// ─── Sleep Patterns & Correlations ──────────────────────────────────────────

function CorrRow({ icon, label, yesVal, noVal, nYes, noLabel, yesLabel, unit = '%', invert = false }) {
  if (yesVal == null || nYes < 2) return null
  const delta = noVal != null ? +(yesVal - noVal).toFixed(1) : null
  const positive = invert ? delta < 0 : delta > 0
  const color = delta == null ? 'var(--text3)' : Math.abs(delta) < 1 ? 'var(--text3)' : positive ? 'var(--green)' : 'var(--red)'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'start', padding: '7px 0', borderBottom: '0.5px solid var(--border)' }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
          {yesLabel || 'Yes'}: <strong>{yesVal}{unit}</strong>
          {noVal != null && <> · {noLabel || 'No'}: <strong>{noVal}{unit}</strong></>}
          <span style={{ color: 'var(--text3)', marginLeft: 4 }}>n={nYes}</span>
        </div>
      </div>
      {delta != null && Math.abs(delta) >= 0.5 && (
        <div style={{ fontSize: 12, fontWeight: 700, color, textAlign: 'right', whiteSpace: 'nowrap' }}>
          {delta > 0 ? '+' : ''}{delta}{unit}
        </div>
      )}
    </div>
  )
}

function SleepStatsCard({ userId, lang }) {
  const [patterns, setPatterns] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    Promise.all([
      supabase.from('daily_logs').select('*').eq('user_id', userId)
        .order('date', { ascending: true }).limit(90),
      supabase.from('sleep_hr_analysis').select('*').eq('user_id', userId)
        .order('date', { ascending: true }).limit(90),
      supabase.from('meal_logs').select('date,is_caffeinated,is_alcohol,consumed_at').eq('user_id', userId)
        .order('date', { ascending: false }).limit(200),
    ]).then(([{ data: logs, error: e1 }, { data: hr, error: e2 }, { data: meals, error: e3 }]) => {
      if (e1 || e2 || e3) { console.error('SleepStats fetch error', e1||e2||e3); setLoading(false); return }
      if (!logs?.length || logs.length < 4) { setLoading(false); return }
      try {

      const avg = arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : null
      const pct = (n, total) => total ? Math.round(n/total*100) : 0

      // Build lookups
      const hrByDate = {}
      hr?.forEach(d => { hrByDate[d.date] = d })
      const mealsByDate = {}
      meals?.forEach(m => {
        if (!mealsByDate[m.date]) mealsByDate[m.date] = []
        mealsByDate[m.date].push(m)
      })

      // Annotate logs with hr data
      const enriched = logs.map(l => ({
        ...l,
        hr: hrByDate[l.date] || null,
        stability: hrByDate[l.date]?.stability_score ?? null,
        deep_pct: hrByDate[l.date]?.deep_pct ?? null,
        rem_pct: hrByDate[l.date]?.rem_pct ?? null,
        awake_pct: hrByDate[l.date]?.awake_pct ?? null,
        spike_count: hrByDate[l.date]?.spike_count ?? null,
        likely_cause: hrByDate[l.date]?.likely_cause ?? null,
        had_alcohol: (mealsByDate[l.date] || []).some(m => m.is_alcohol),
        had_caffeine_late: (mealsByDate[l.date] || []).some(m => m.is_caffeinated && m.consumed_at >= '17:00'),
      }))

      const withRecovery = enriched.filter(l => l.recovery_score != null)
      const withStability = enriched.filter(l => l.stability != null)
      const withSleep = enriched.filter(l => l.sleep_duration != null)
      const total = enriched.length
      const totalHr = hr?.length || 0

      // ── OVERALL BASELINES ──
      const baseline = {
        recovery: avg(withRecovery.map(l => l.recovery_score)),
        hrv: avg(enriched.filter(l=>l.hrv).map(l=>l.hrv)),
        rhr: avg(enriched.filter(l=>l.rhr).map(l=>l.rhr)),
        sleepDuration: avg(withSleep.map(l => l.sleep_duration)),
        sleepEfficiency: avg(enriched.filter(l=>l.sleep_efficiency).map(l=>l.sleep_efficiency)),
        stability: avg(withStability.map(l => l.stability)),
        deep: avg(withStability.map(l => l.deep_pct).filter(Boolean)),
        rem: avg(withStability.map(l => l.rem_pct).filter(Boolean)),
        awake: avg(withStability.map(l => l.awake_pct).filter(Boolean)),
        avgSpikes: avg(withStability.map(l => l.spike_count).filter(v => v!=null)),
        nights: total,
        hrNights: totalHr,
      }

      // ── CAUSE BREAKDOWN ──
      const causeCounts = {}
      hr?.forEach(d => { if(d.likely_cause) causeCounts[d.likely_cause]=(causeCounts[d.likely_cause]||0)+1 })
      const causes = Object.entries(causeCounts).sort((a,b)=>b[1]-a[1])

      // ── BEHAVIOUR CORRELATIONS ──
      const split = (condition, metric) => {
        const yes = enriched.filter(condition)
        const no = enriched.filter(l => !condition(l))
        return {
          yes: avg(yes.map(l=>l[metric]).filter(v=>v!=null)),
          no: avg(no.map(l=>l[metric]).filter(v=>v!=null)),
          nYes: yes.filter(l=>l[metric]!=null).length,
          nNo: no.filter(l=>l[metric]!=null).length,
        }
      }

      // Next-day metric after a given condition on previous day
      const nextDaySplit = (condition, metric) => {
        const withCondition = [], withoutCondition = []
        for (let i = 0; i < enriched.length - 1; i++) {
          const next = enriched[i+1]
          if (next[metric] == null) continue
          if (condition(enriched[i])) withCondition.push(next[metric])
          else withoutCondition.push(next[metric])
        }
        return { yes: avg(withCondition), no: avg(withoutCondition), nYes: withCondition.length, nNo: withoutCondition.length }
      }

      const corrs = {
        // Phone timing
        phoneEarly: split(l => l.phone_away_time && l.phone_away_time < '22:30', 'recovery_score'),
        phoneLate:  split(l => l.phone_away_time && l.phone_away_time >= '23:00', 'recovery_score'),
        phoneOnStability: split(l => l.phone_away_time && l.phone_away_time < '22:30', 'stability'),

        // Wind-down
        windGood: split(l => l.wind_down === 'good', 'recovery_score'),
        windPoor: split(l => l.wind_down === 'poor', 'recovery_score'),
        windOnStability: split(l => l.wind_down === 'good', 'stability'),

        // Activities → next day
        gymNextDay: nextDaySplit(l => l.activity?.some(a=>a.includes('gym')), 'recovery_score'),
        saunaNextDay: nextDaySplit(l => l.activity?.some(a=>a.includes('sauna')), 'recovery_score'),
        runNextDay: nextDaySplit(l => l.activity?.some(a=>a.includes('run')), 'recovery_score'),

        // Temperature
        tempCool: split(l => l.ac_temp && l.ac_temp <= 67, 'stability'),
        tempWarm: split(l => l.ac_temp && l.ac_temp >= 70, 'stability'),

        // Dinner timing
        dinnerEarly: split(l => l.dinner_time && l.dinner_time < '19:00', 'stability'),
        dinnerLate:  split(l => l.dinner_time && l.dinner_time >= '20:30', 'stability'),

        // Alcohol → same night
        alcoholOnRecovery: split(l => l.had_alcohol, 'recovery_score'),
        alcoholOnStability: split(l => l.had_alcohol, 'stability'),
        alcoholOnSpikes: split(l => l.had_alcohol, 'spike_count'),

        // Caffeine late → sleep
        caffeineOnEfficiency: split(l => l.had_caffeine_late, 'sleep_efficiency'),
        caffeineOnStability: split(l => l.had_caffeine_late, 'stability'),

        // Meditation habit
        meditationOnRecovery: nextDaySplit(l => l.habits?.some(h=>h.includes('meditat')), 'recovery_score'),

        // Water intake
        hydratedOnRecovery: split(l => l.water && l.water >= 2000, 'recovery_score'),
        dehyOnRecovery: split(l => l.water && l.water < 1200, 'recovery_score'),

        // Steps
        activeOnRecovery: nextDaySplit(l => l.steps && l.steps >= 8000, 'recovery_score'),
      }

      // Trend: split into thirds
      const third = Math.floor(withRecovery.length / 3)
      const early3rd = avg(withRecovery.slice(0, third).map(l=>l.recovery_score))
      const late3rd = avg(withRecovery.slice(-third).map(l=>l.recovery_score))
      const recoveryTrend = early3rd && late3rd ? +(late3rd - early3rd).toFixed(1) : null

      const stabFirst = avg(withStability.slice(0, Math.floor(withStability.length/2)).map(l=>l.stability))
      const stabLast  = avg(withStability.slice(Math.floor(withStability.length/2)).map(l=>l.stability))
      const stabilityTrend = stabFirst && stabLast ? +(stabLast - stabFirst).toFixed(1) : null

      setPatterns({ baseline, causes, corrs, recoveryTrend, stabilityTrend })
      setLoading(false)
      } catch(err) { console.error('SleepStats compute error:', err); setError(err.message); setLoading(false) }
    }).catch(err => { console.error('SleepStats promise error:', err); setLoading(false) })
  }, [userId])

  if (loading) return <div style={{ padding: '10px 0 4px', fontSize: 11, color: 'var(--text3)' }}>Analysing patterns...</div>
  if (error) return <div style={{ padding: '10px 0', fontSize: 11, color: 'var(--text3)' }}>Pattern analysis unavailable.</div>
  if (!patterns) return <div style={{ padding: '10px 0', fontSize: 11, color: 'var(--text3)' }}>Upload WHOOP screenshots to unlock pattern analysis.</div>

  const { baseline, causes, corrs, recoveryTrend, stabilityTrend } = patterns
  const c = corrs || {}
  // Guard all correlation objects against null
  const safe = (obj) => obj || { yes: null, no: null, nYes: 0, nNo: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Baselines */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          📊 Your baselines · {baseline.nights} nights logged · {baseline.hrNights} analysed
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            { label: 'Recovery', value: baseline.recovery, unit: '%', color: baseline.recovery >= 67 ? 'var(--green)' : baseline.recovery >= 34 ? 'var(--amber)' : 'var(--red)' },
            { label: 'HRV', value: baseline.hrv, unit: 'ms', color: 'var(--purple)' },
            { label: 'RHR', value: baseline.rhr, unit: 'bpm', color: 'var(--blue)' },
            { label: 'Sleep', value: baseline.sleepDuration, unit: 'h', color: 'var(--blue)' },
            { label: 'Stability', value: baseline.stability, unit: '/10', color: baseline.stability >= 7 ? 'var(--green)' : 'var(--amber)' },
            { label: 'Deep', value: baseline.deep, unit: '%', color: 'var(--purple)' },
          ].filter(m => m.value != null).map(m => (
            <div key={m.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}{m.unit}</div>
            </div>
          ))}
        </div>
        {(recoveryTrend != null || stabilityTrend != null) && (
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            {recoveryTrend != null && (
              <span style={{ fontSize: 11, color: recoveryTrend >= 0 ? 'var(--green)' : 'var(--red)' }}>
                Recovery {recoveryTrend >= 0 ? '↑' : '↓'} {Math.abs(recoveryTrend)}% over time
              </span>
            )}
            {stabilityTrend != null && (
              <span style={{ fontSize: 11, color: stabilityTrend >= 0 ? 'var(--green)' : 'var(--red)' }}>
                · Stability {stabilityTrend >= 0 ? '↑' : '↓'} {Math.abs(stabilityTrend)} pts
              </span>
            )}
          </div>
        )}
      </div>

      {/* Disruption causes */}
      {causes.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            ⚡ Disruption causes ({baseline.hrNights} nights)
          </div>
          {causes.map(([cause, n]) => {
            const labels = { thyroid: 'Thyroid medication', stress: 'Stress / cortisol', apnea: 'Sleep apnea', temperature: 'Temperature', food: 'Food / digestion', caffeine: 'Caffeine', alcohol: 'Alcohol', mixed: 'Multiple factors', unclear: 'Unclear' }
            const colors = { thyroid: 'var(--blue)', stress: 'var(--amber)', apnea: 'var(--red)', temperature: 'var(--purple)', food: 'var(--amber)', caffeine: 'var(--amber)', alcohol: 'var(--purple)', mixed: 'var(--text2)' }
            return (
              <div key={cause} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{labels[cause] || cause}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)' }}>{n}× · {pct(n, baseline.hrNights)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
                    <div style={{ height: 4, borderRadius: 2, background: colors[cause] || 'var(--text3)', width: pct(n, baseline.hrNights) + '%' }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Behaviour correlations */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          🔬 Behaviour → sleep quality
        </div>
        <CorrRow icon="📵" label="Phone away before 22:30 → recovery" yesLabel="Early" noLabel="Late/none" yesVal={safe(c.phoneEarly).yes} noVal={safe(c.phoneLate).yes} nYes={safe(c.phoneEarly).nYes} />
        <CorrRow icon="📵" label="Phone cutoff → stability score" yesLabel="Early" noLabel="Late" yesVal={safe(c.phoneOnStability).yes} noVal={safe(c.phoneOnStability).no} nYes={safe(c.phoneOnStability).nYes} unit="/10" />
        <CorrRow icon="😌" label="Good wind-down → recovery" yesLabel="Good" noLabel="Poor" yesVal={safe(c.windGood).yes} noVal={safe(c.windPoor).yes} nYes={safe(c.windGood).nYes} />
        <CorrRow icon="😌" label="Good wind-down → stability" yesLabel="Good" noLabel="No good" yesVal={safe(c.windOnStability).yes} noVal={safe(c.windOnStability).no} nYes={safe(c.windOnStability).nYes} unit="/10" />
        <CorrRow icon="🏋️" label="Gym day → next day recovery" yesLabel="After gym" noLabel="Rest day" yesVal={safe(c.gymNextDay).yes} noVal={safe(c.gymNextDay).no} nYes={safe(c.gymNextDay).nYes} />
        <CorrRow icon="🧖" label="Sauna day → next day recovery" yesLabel="After sauna" noLabel="No sauna" yesVal={safe(c.saunaNextDay).yes} noVal={safe(c.saunaNextDay).no} nYes={safe(c.saunaNextDay).nYes} />
        <CorrRow icon="🏃" label="Run day → next day recovery" yesLabel="After run" noLabel="No run" yesVal={safe(c.runNextDay).yes} noVal={safe(c.runNextDay).no} nYes={safe(c.runNextDay).nYes} />
        <CorrRow icon="❄" label="Cool room (≤67°F) → stability" yesLabel="≤67°F" noLabel="≥70°F" yesVal={safe(c.tempCool).yes} noVal={safe(c.tempWarm).yes} nYes={safe(c.tempCool).nYes} unit="/10" />
        <CorrRow icon="🍽" label="Early dinner (<19:00) → stability" yesLabel="<19:00" noLabel=">20:30" yesVal={safe(c.dinnerEarly).yes} noVal={safe(c.dinnerLate).yes} nYes={safe(c.dinnerEarly).nYes} unit="/10" />
        <CorrRow icon="🍷" label="Alcohol → recovery" yesLabel="Alcohol" noLabel="No alcohol" yesVal={safe(c.alcoholOnRecovery).yes} noVal={safe(c.alcoholOnRecovery).no} nYes={safe(c.alcoholOnRecovery).nYes} />
        <CorrRow icon="🍷" label="Alcohol → HR stability" yesLabel="Alcohol" noLabel="No alcohol" yesVal={safe(c.alcoholOnStability).yes} noVal={safe(c.alcoholOnStability).no} nYes={safe(c.alcoholOnStability).nYes} unit="/10" />
        <CorrRow icon="🍷" label="Alcohol → HR spikes" yesLabel="Alcohol" noLabel="No alcohol" yesVal={safe(c.alcoholOnSpikes).yes} noVal={safe(c.alcoholOnSpikes).no} nYes={safe(c.alcoholOnSpikes).nYes} unit="" invert={true} />
        <CorrRow icon="☕" label="Late caffeine (>17:00) → efficiency" yesLabel="Late caffeine" noLabel="No late caffeine" yesVal={safe(c.caffeineOnEfficiency).yes} noVal={safe(c.caffeineOnEfficiency).no} nYes={safe(c.caffeineOnEfficiency).nYes} />
        <CorrRow icon="☕" label="Late caffeine → stability" yesLabel="Late caffeine" noLabel="None" yesVal={safe(c.caffeineOnStability).yes} noVal={safe(c.caffeineOnStability).no} nYes={safe(c.caffeineOnStability).nYes} unit="/10" />
        <CorrRow icon="🧘" label="Meditation → next day recovery" yesLabel="With meditation" noLabel="Without" yesVal={safe(c.meditationOnRecovery).yes} noVal={safe(c.meditationOnRecovery).no} nYes={safe(c.meditationOnRecovery).nYes} />
        <CorrRow icon="💧" label="Good hydration (≥2L) → recovery" yesLabel="≥2L" noLabel="<1.2L" yesVal={safe(c.hydratedOnRecovery).yes} noVal={safe(c.dehyOnRecovery).yes} nYes={safe(c.hydratedOnRecovery).nYes} />
        <CorrRow icon="👟" label="Active day (≥8k steps) → next recovery" yesLabel="≥8k steps" noLabel="Less active" yesVal={safe(c.activeOnRecovery).yes} noVal={safe(c.activeOnRecovery).no} nYes={safe(c.activeOnRecovery).nYes} />
      </div>

    </div>
  )
}


function WhoopTab({ log, yesterdayLog, session, lang, onRefresh }) {
  const date = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const [hrAnalysis, setHrAnalysis] = useState(null)
  const [forceUpload, setForceUpload] = useState(false)

  function fetchHrAnalysis() {
    supabase.from('sleep_hr_analysis')
      .select('*').eq('user_id', session.user.id)
      .gte('date', yesterday).order('date', { ascending: false }).limit(3)
      .then(({ data, error }) => {
        setHrAnalysis(data?.[0] || null)
      })
  }

  useEffect(() => { fetchHrAnalysis() }, [session.user.id, date])

  // bed_time can be on today's log (uploaded today) or yesterday's log (uploaded via old Trends flow)
  // Prefer today's bed_time (from new upload), fall back to yesterday's
  // Also correct 12:xx AM misread (12:03 AM should be 00:03, not noon)
  function correctBedTime(t) {
    if (!t) return null
    const [h] = t.split(':').map(Number)
    // Sleep onset of 12:xx is almost certainly midnight (00:xx), never noon
    return h === 12 ? '00:' + t.slice(3) : t
  }
  const bedTime = correctBedTime(log?.bed_time) || correctBedTime(yesterdayLog?.bed_time)
  const uploaded = !!bedTime



  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Temperature curve — shown if SwitchBot data was captured */}
      {hrAnalysis?.temp_curve && (() => {
        try {
          const curve = JSON.parse(hrAnalysis.temp_curve)
          if (!curve?.length) return null
          const temps = curve.map(p => p.f)
          const minT = Math.min(...temps), maxT = Math.max(...temps)
          const range = maxT - minT || 1
          return (
            <div style={{ padding: '12px 14px', borderTop: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                🌡 Overnight temperature · avg {hrAnalysis.temp_avg_f}°F · {hrAnalysis.temp_min_f}–{hrAnalysis.temp_max_f}°F range
                {hrAnalysis.humidity_avg ? ' · ' + hrAnalysis.humidity_avg + '% humidity' : ''}
              </div>
              <div style={{ position: 'relative', height: 52, background: 'var(--surface2)', borderRadius: 6, overflow: 'hidden' }}>
                <svg width="100%" height="52" viewBox={'0 0 ' + curve.length + ' 52'} preserveAspectRatio="none" style={{ display: 'block' }}>
                  <polyline
                    points={curve.map((p, i) => (i + 0.5) + ',' + (52 - ((p.f - minT) / range) * 40 - 6)).join(' ')}
                    fill="none" stroke="var(--blue)" strokeWidth="1.5" strokeLinejoin="round"
                  />
                </svg>
                <div style={{ position: 'absolute', top: 3, left: 6, fontSize: 9, color: 'var(--blue)', fontFamily: 'var(--font-mono)' }}>{maxT}°F</div>
                <div style={{ position: 'absolute', bottom: 3, left: 6, fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{minT}°F</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 9, color: 'var(--text3)' }}>
                <span>{new Date(curve[0].t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{new Date(curve[curve.length-1].t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          )
        } catch(e) { return null }
      })()}

      {/* Deep dive — last night root cause analysis */}
      <div style={{ borderTop: '0.5px solid var(--border)' }}>
        <SleepDeepDive log={log} hrAnalysis={hrAnalysis} session={session} />
      </div>

    </div>
  )
}


// ─── AI Insight ───────────────────────────────────────────────────────────────

// Anomaly prompts shown when sleep fragmentation detected
const ANOMALY_PROMPTS = [
  { id: 'bathroom', label: '🚽 Left bed to use bathroom', emoji: '🚽' },
  { id: 'dreams', label: '😨 Bad dreams / nightmares', emoji: '😨' },
  { id: 'thoughts', label: '🧠 Thoughts kept me awake', emoji: '🧠' },
  { id: 'couldnt_sleep', label: "😶 Woke up, couldn't go back to sleep", emoji: '😶' },
  { id: 'noise', label: '🔊 Noise / disturbance', emoji: '🔊' },
  { id: 'temperature', label: '🥵 Too hot / too cold', emoji: '🥵' },
  { id: 'none', label: '🤷 Nothing I can identify', emoji: '🤷' },
]

function InsightCard({ log, userId, lang }) {
  const [insight, setInsight] = useState(log?.ai_insight || '')
  const [loading, setLoading] = useState(false)
  const [hrAnalysis, setHrAnalysis] = useState(null)
  const [anomalyText, setAnomalyText] = useState('')
  const [showAnomalyPrompt, setShowAnomalyPrompt] = useState(false)
  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  useEffect(() => { setInsight(log?.ai_insight || '') }, [log?.ai_insight])

  useEffect(() => {
    supabase.from('sleep_hr_analysis').select('*').eq('user_id', userId)
      .gte('date', yesterday).order('date', { ascending: false }).limit(2)
      .then(({ data }) => {
        const hr = data?.[0] || null
        setHrAnalysis(hr)
        // Auto-show anomaly prompt if fragmentation detected and no insight yet
        if (hr && (hr.micro_arousals_likely || (hr.awake_pct && hr.awake_pct > 15) || (hr.spike_count && hr.spike_count > 5)) && !log?.ai_insight) {
          setShowAnomalyPrompt(true)
        }
      })
  }, [userId, today])

  async function generateInsight(extraContext = '') {
    setLoading(true)
    try {
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')

      const [
        { data: yesterdayLog }, { data: history }, { data: yesterdayEvents },
        { data: travelState }, { data: caffeineMeals }, { data: alcoholMeals },
        { data: suppLogs }, { data: medLogs }, { data: poopLogs },
        { data: goals }, { data: hrData },
      ] = await Promise.all([
        supabase.from('daily_logs').select('*').eq('user_id', userId).eq('date', yesterday).maybeSingle(),
        supabase.from('daily_logs').select('*').eq('user_id', userId).gte('date', thirtyDaysAgo).lt('date', today).order('date', { ascending: true }),
        supabase.from('daily_events').select('*').eq('user_id', userId).eq('date', yesterday),
        supabase.from('travel_state').select('*').eq('user_id', userId).eq('active', true).maybeSingle(),
        supabase.from('meal_logs').select('meal_name,consumed_at').eq('user_id', userId).eq('date', yesterday).eq('is_caffeinated', true),
        supabase.from('meal_logs').select('meal_name,consumed_at').eq('user_id', userId).eq('date', yesterday).eq('is_alcohol', true),
        supabase.from('supplement_logs').select('taken,taken_time,quantity').eq('user_id', userId).eq('date', yesterday).eq('taken', true),
        supabase.from('medication_logs').select('taken,taken_time').eq('user_id', userId).eq('date', yesterday).eq('taken', true),
        supabase.from('poop_logs').select('bristol_type,logged_at,assessment,flags,color').eq('user_id', userId).eq('date', yesterday),
        supabase.from('goals').select('name,category,target_value,timeframe').eq('user_id', userId),
        supabase.from('sleep_hr_analysis').select('*').eq('user_id', userId).gte('date', yesterday).order('date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('sleep_hr_analysis').select('likely_cause,stability_score,spike_count,awake_pct,deep_pct,rem_pct').eq('user_id', userId).order('date', { ascending: false }).limit(30),
      ])

      if (hrData) setHrAnalysis(hrData)

      const hrContext = hrData ? `
SLEEP HR ANALYSIS:
- Stages: Awake ${hrData.awake_pct || '—'}%, Light ${hrData.light_pct || '—'}%, Deep ${hrData.deep_pct || '—'}%, REM ${hrData.rem_pct || '—'}%
- HR: baseline ${hrData.hr_baseline || '—'}bpm, spikes ${hrData.spike_count ?? '—'} (max ${hrData.spike_max_magnitude || '—'}bpm), stability ${hrData.stability_score || '—'}/10
- Likely cause: ${hrData.likely_cause || 'unclear'} (${hrData.cause_confidence || '—'}) — ${hrData.cause_reasoning || 'n/a'}
- Recommendation: ${hrData.recommendation || 'n/a'}` + (hrData.temp_avg_f ? `
BEDROOM TEMPERATURE (SwitchBot measured):
- Average: ${hrData.temp_avg_f}°F / ${hrData.temp_avg_c}°C
- Range: ${hrData.temp_min_f}–${hrData.temp_max_f}°F overnight
- Humidity: ${hrData.humidity_avg || '—'}%
- Note: optimal sleep temperature is 65–68°F (18–20°C)` : '') : ''

      const suppContext = suppLogs?.length ? '\n- Supplements taken: ' + suppLogs.length + ' item(s)' + (suppLogs[0]?.taken_time ? ', last at ' + (suppLogs[suppLogs.length-1]?.taken_time?.slice(0,5) || '') : '') : '\n- Supplements: none logged'

      const medContext = medLogs?.length ? '\n- Medications taken: ' + medLogs.length + ' item(s)' + (medLogs[0]?.taken_time ? ', last at ' + (medLogs[medLogs.length-1]?.taken_time?.slice(0,5) || '') : '') : ''

      const poopContext = poopLogs?.length
        ? '\n- Bowel movements yesterday: ' + poopLogs.length + 'x — ' +
          poopLogs.map(p => 'Type ' + p.bristol_type +
            (p.color && p.color !== 'brown' ? ' (' + p.color + ')' : '') +
            (p.flags?.length ? ' ⚠️ ' + p.flags.join(', ') : '')
          ).join(', ') +
          (poopLogs[0]?.assessment ? '. ' + poopLogs[0].assessment : '')
        : ''

      const goalsContext = goals?.length
        ? '\nPERSONAL TARGETS: ' + goals.filter(g => g.target_value).map(g => g.name + ' ' + g.target_value + '/' + g.timeframe).join(' · ')
        : ''

      // Historical sleep pattern summary for Claude
      const hrHistoryContext = hrHistory?.length >= 3 ? (() => {
        const causes = {}
        hrHistory.forEach(d => { if (d.likely_cause) causes[d.likely_cause] = (causes[d.likely_cause] || 0) + 1 })
        const topCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3)
        const avgStab = hrHistory.filter(d => d.stability_score).length
          ? (hrHistory.filter(d => d.stability_score).reduce((a, d) => a + d.stability_score, 0) / hrHistory.filter(d => d.stability_score).length).toFixed(1)
          : null
        return '\nHISTORICAL SLEEP PATTERNS (' + hrHistory.length + ' nights analysed):' +
          (avgStab ? '\n- Avg stability score: ' + avgStab + '/10' : '') +
          (topCauses.length ? '\n- Most common disruption causes: ' + topCauses.map(([c, n]) => c + ' (' + n + 'x)').join(', ') : '')
      })() : ''

      const fullHrContext = hrContext + hrHistoryContext + suppContext + medContext + poopContext + goalsContext +
        (extraContext ? `

ADDITIONAL CONTEXT FROM SEBASTIAN: ${extraContext}` : '')

      const text = await generateDailyInsight(log, yesterdayLog, history || [], lang, yesterdayEvents || [], [], travelState, caffeineMeals || [], fullHrContext, alcoholMeals || [])
      setInsight(text)

      await supabase.from('daily_logs').upsert({
        user_id: userId, date: today, ai_insight: text, ai_insight_date: today,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })
    } catch (e) {
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setLoading(false)
  }

  const yesterdayDate = format(subDays(new Date(), 1), 'd MMM')
  const todayDate = format(new Date(), 'd MMM')

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Anomaly prompt — shown when fragmentation detected */}
      {showAnomalyPrompt && !insight && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
            ⚠️ {lang === 'de' ? 'Schlafunterbrechungen erkannt — was ist passiert?' : 'Sleep disruption detected — anything happen last night?'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            {lang === 'de' ? 'Wähle alles Zutreffende aus — wird in die Analyse einbezogen' : 'Select all that apply — this will be folded into the analysis'}
          </div>
          <textarea
            className="field-input"
            value={anomalyText}
            onChange={e => setAnomalyText(e.target.value)}
            placeholder={lang === 'de'
              ? 'z.B. musste zweimal auf Toilette, schlechte Träume, Gedanken kreisten...'
              : 'e.g. got up twice to use bathroom, bad dreams, mind was racing, too hot...'}
            rows={3}
            style={{ resize: 'none', fontSize: 13 }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAnomalyPrompt(false)} className="btn-secondary" style={{ flex: 1 }}>
              {lang === 'de' ? 'Überspringen' : 'Skip'}
            </button>
            <button onClick={() => {
              setShowAnomalyPrompt(false)
              generateInsight(anomalyText.trim())
            }} className="btn-primary" style={{ flex: 2 }} disabled={loading}>
              {loading ? (lang === 'de' ? 'Analysiere...' : 'Analysing...') : (lang === 'de' ? '✨ Analyse generieren' : '✨ Generate analysis')}
            </button>
          </div>
        </div>
      )}

      {insight ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{insight}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => generateInsight()} disabled={loading} style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
              {loading ? '...' : '↺ Re-analyse'}
            </button>
            {hrAnalysis && (hrAnalysis.micro_arousals_likely || (hrAnalysis.awake_pct > 15)) && (
              <button onClick={() => { setAnomalyText(''); setShowAnomalyPrompt(true); setInsight('') }} style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid var(--amber)', background: 'rgba(186,117,23,0.08)', color: 'var(--amber)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                ⚠️ {lang === 'de' ? 'Kontext hinzufügen' : 'Add context'}
              </button>
            )}
          </div>
        </>
      ) : !showAnomalyPrompt && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
            {lang === 'de'
              ? `Verbindet deinen Abend vom ${yesterdayDate} mit deinen WHOOP-Daten von heute.`
              : `Connects your evening of ${yesterdayDate} with today's WHOOP data. Generate when you've logged everything.`}
          </div>
          <button className="btn-primary" onClick={() => generateInsight()} disabled={loading}>
            {loading ? (lang === 'de' ? 'Analysiere...' : 'Analysing...') : (lang === 'de' ? '✨ Analyse generieren' : '✨ Generate analysis')}
          </button>
        </>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DailyIntelligence({ session, log, onSave, habitGoals, activeHabits, onToggleHabit }) {
  const { lang } = useLang()
  const [yesterdayLog, setYesterdayLog] = useState(null)

  // Fetch yesterday's log
  useEffect(() => {
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
    supabase.from('daily_logs').select('*').eq('user_id', session.user.id).eq('date', yesterday).maybeSingle()
      .then(({ data }) => setYesterdayLog(data))
  }, [session.user.id])

  const hasMorning = log?.morning_energy > 0
  const hasWhoop = !!(log?.bed_time || yesterdayLog?.bed_time)
  const hasInsight = !!log?.ai_insight
  // Check-in is complete when both WHOOP uploaded AND morning scores logged
  const hasCheckin = hasMorning && hasWhoop

  // Smart default: guide user through the flow in order
  const defaultSection = !hasCheckin ? 'checkin' : !hasInsight ? 'sleep' : 'insight'
  const [section, setSection] = useState(defaultSection)

  const sections = [
    { key: 'checkin', label: lang === 'de' ? '🌅 Check-in' : '🌅 Check-in', done: hasCheckin },
    { key: 'sleep',   label: lang === 'de' ? '😴 Schlaf'   : '😴 Sleep',    done: hasWhoop },
    { key: 'insight', label: lang === 'de' ? '✨ Analyse'  : '✨ Insight',   done: hasInsight },
  ]

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">🧠 {lang === 'de' ? 'Tages-Analyse' : 'Daily Intelligence'}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {[hasMorning, hasWhoop, hasInsight].filter(Boolean).length}/3
        </span>
      </div>

      {/* Tab row */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
        {sections.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)} style={{
            flex: 1, padding: '9px 4px', background: 'none', border: 'none',
            borderBottom: `2px solid ${section === s.key ? 'var(--green)' : 'transparent'}`,
            color: section === s.key ? 'var(--green)' : 'var(--text2)',
            fontSize: 11, fontWeight: section === s.key ? 700 : 400,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            {s.label}
            {s.done && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />}
          </button>
        ))}
      </div>

      {/* 1. Check-in — morning subjective + last evening summary */}
      {section === 'checkin' && (
        <MorningCheckin log={log} onSave={onSave} lang={lang} yesterdayLog={yesterdayLog} session={session} date={format(new Date(), 'yyyy-MM-dd')} />
      )}

      {/* 2. Sleep — WHOOP upload + last night data + HR analysis */}
      {section === 'sleep' && (
        <WhoopTab log={log} yesterdayLog={yesterdayLog} session={session} lang={lang} onRefresh={onSave} />
      )}

      {/* 3. Insight — full synthesis narrative + sleep stats history */}
      {section === 'insight' && (
        <InsightCard log={log} userId={session.user.id} lang={lang} />
      )}
    </div>
  )
}
