import { CLAUDE_MODEL, CAFFEINE_REGEX } from '../lib/constants'
import { compressImage } from '../lib/imageUtils'
import { useState, useEffect, useRef } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

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
  const [acTemp, setAcTemp] = useState(log?.ac_temp || '')
  const [saving, setSaving] = useState(false)

  // Re-sync when log fields change
  useEffect(() => {
    const phone = log?.phone_away_time?.slice(0,5) || ''
    const home = log?.home_time?.slice(0,5) || ''
    setPhoneAway(phone)
    setHomeTime(home)
    setWindDown(log?.wind_down || '')
    setNote(log?.evening_note || '')
    setAcTemp(log?.ac_temp != null ? String(log.ac_temp) : '')
    if (phoneRef.current) phoneRef.current.value = phone
    if (homeRef.current) homeRef.current.value = home
  }, [log?.phone_away_time, log?.home_time, log?.wind_down, log?.evening_note, log?.ac_temp])

  const labels = lang === 'de'
    ? { habits: 'Abendgewohnheiten', phone: 'Handy weggelegt um', wind: 'Abend-Qualität', note: 'Etwas Besonderes?', save: 'Abend speichern', saving: 'Speichern...', good: 'Gut', ok: 'OK', poor: 'Schlecht', ac: 'AC-Temp (°F)' }
    : { habits: 'Evening habits', phone: 'Phone away at', wind: 'Wind-down quality', note: 'Anything affect your evening?', save: 'Save evening', saving: 'Saving...', good: 'Good', ok: 'OK', poor: 'Poor', ac: 'AC temp (°F)' }

  async function handleSave() {
    // Capture current input values from both ref (DOM) and state (onBlur)
    const phoneVal = phoneRef.current?.value || phoneAway || null
    setSaving(true)
    await onSave({
      phone_away_time: phoneVal || null,
      home_time: homeRef.current?.value || homeTime || null,
      wind_down: windDown || null,
      evening_note: note || null,
      ac_temp: acTemp ? parseFloat(acTemp) : null,
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

        {/* AC temp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>❄</div>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: 'var(--text2)' }}>{labels.ac}</span>
          <input
            className="field-input"
            type="number" step="1"
            value={acTemp}
            onChange={e => setAcTemp(e.target.value)}
            placeholder="68"
            inputMode="numeric"
            style={{ width: 80, textAlign: 'right', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}
          />
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

function SleepStatsCard({ userId, lang }) {
  const [patterns, setPatterns] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    Promise.all([
      supabase.from('daily_logs').select('*').eq('user_id', userId)
        .not('recovery_score', 'is', null).order('date', { ascending: false }).limit(60),
      supabase.from('sleep_hr_analysis').select('*').eq('user_id', userId)
        .order('date', { ascending: false }).limit(60),
    ]).then(([{ data: logs }, { data: hrData }]) => {
      if (!logs?.length || logs.length < 5) { setLoading(false); return }

      // Helper: avg of array
      const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null
      const diff = (a, b) => a != null && b != null ? +(a - b).toFixed(1) : null

      // Build hr lookup by date
      const hrByDate = {}
      hrData?.forEach(d => { hrByDate[d.date] = d })

      // ── Correlations using daily_logs ──

      // 1. Late phone (>23:00) vs early phone (<22:30) → recovery
      const latePhone = logs.filter(l => l.phone_away_time && l.phone_away_time >= '23:00')
      const earlyPhone = logs.filter(l => l.phone_away_time && l.phone_away_time < '22:30')
      const phoneEffect = {
        late: avg(latePhone.map(l => l.recovery_score).filter(Boolean)),
        early: avg(earlyPhone.map(l => l.recovery_score).filter(Boolean)),
        n: latePhone.length + earlyPhone.length,
      }

      // 2. Gym days → next day recovery
      const gymDays = logs.filter(l => l.activity?.some(a => a.includes('gym')))
      const gymNextDay = gymDays.map(l => {
        const next = logs.find(n => n.date > l.date)
        return next?.recovery_score
      }).filter(Boolean)
      const noGymNextDay = logs.filter(l => !l.activity?.some(a => a.includes('gym')))
        .map(l => l.recovery_score).filter(Boolean)
      const gymEffect = {
        with: avg(gymNextDay),
        without: avg(noGymNextDay),
        n: gymNextDay.length,
      }

      // 3. AC temp bands → stability score
      const coolNights = logs.filter(l => l.ac_temp && l.ac_temp <= 67)
        .map(l => hrByDate[l.date]?.stability_score).filter(Boolean)
      const warmNights = logs.filter(l => l.ac_temp && l.ac_temp >= 70)
        .map(l => hrByDate[l.date]?.stability_score).filter(Boolean)
      const tempEffect = coolNights.length >= 2 && warmNights.length >= 2 ? {
        cool: avg(coolNights), warm: avg(warmNights), n: coolNights.length + warmNights.length
      } : null

      // 4. Wind-down quality → recovery
      const goodWindDown = logs.filter(l => l.wind_down === 'good').map(l => l.recovery_score).filter(Boolean)
      const poorWindDown = logs.filter(l => l.wind_down === 'poor').map(l => l.recovery_score).filter(Boolean)
      const windDownEffect = goodWindDown.length >= 2 && poorWindDown.length >= 2 ? {
        good: avg(goodWindDown), poor: avg(poorWindDown), n: goodWindDown.length + poorWindDown.length
      } : null

      // 5. Late dinner (>20:00) → stability
      const lateDinner = logs.filter(l => l.dinner_time && l.dinner_time >= '20:00')
        .map(l => hrByDate[l.date]?.stability_score).filter(Boolean)
      const earlyDinner = logs.filter(l => l.dinner_time && l.dinner_time < '19:00')
        .map(l => hrByDate[l.date]?.stability_score).filter(Boolean)
      const dinnerEffect = lateDinner.length >= 2 && earlyDinner.length >= 2 ? {
        late: avg(lateDinner), early: avg(earlyDinner), n: lateDinner.length + earlyDinner.length
      } : null

      // 6. Sauna → next day recovery
      const saunaDays = logs.filter(l => l.activity?.some(a => a.includes('sauna')))
      const saunaNextDay = saunaDays.map(l => {
        const next = logs.find(n => n.date > l.date)
        return next?.recovery_score
      }).filter(Boolean)
      const saunaEffect = saunaNextDay.length >= 2 ? {
        with: avg(saunaNextDay),
        without: avg(noGymNextDay),
        n: saunaNextDay.length,
      } : null

      // 7. HR spike causes frequency
      const causes = {}
      hrData?.forEach(d => { if (d.likely_cause && d.likely_cause !== 'unclear') causes[d.likely_cause] = (causes[d.likely_cause] || 0) + 1 })
      const topCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 4)

      // 8. Trend: stability last 14 vs prior 14
      const hrWithStab = hrData?.filter(d => d.stability_score != null) || []
      const recent14 = avg(hrWithStab.slice(0, 14).map(d => d.stability_score))
      const prior14 = avg(hrWithStab.slice(14, 28).map(d => d.stability_score))
      const stabilityTrend = diff(recent14, prior14)

      setPatterns({ phoneEffect, gymEffect, tempEffect, windDownEffect, dinnerEffect, saunaEffect, topCauses, stabilityTrend, recent14, total: hrData?.length || 0 })
      setLoading(false)
    })
  }, [userId])

  if (loading) return <div style={{ padding: '12px 14px 4px', fontSize: 11, color: 'var(--text3)' }}>Analysing patterns...</div>
  if (!patterns) return <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text3)' }}>Upload WHOOP screenshots to unlock pattern analysis.</div>

  // Build insight cards from computed correlations
  const insights = []

  const { phoneEffect, gymEffect, tempEffect, windDownEffect, dinnerEffect, saunaEffect, topCauses, stabilityTrend, recent14, total } = patterns

  if (phoneEffect.early != null && phoneEffect.late != null && phoneEffect.n >= 4) {
    const delta = +(phoneEffect.early - phoneEffect.late).toFixed(0)
    insights.push({
      icon: '📵',
      label: 'Phone away early vs late',
      finding: delta > 0
        ? `Putting phone away before 22:30 → ${delta}% higher recovery (${phoneEffect.early}% vs ${phoneEffect.late}%)`
        : `No clear recovery difference yet between early/late phone cutoff`,
      signal: delta > 5 ? 'positive' : 'neutral',
    })
  }

  if (gymEffect.with != null && gymEffect.n >= 3) {
    const delta = +(gymEffect.with - (gymEffect.without || gymEffect.with)).toFixed(0)
    insights.push({
      icon: '🏋️',
      label: 'Day after gym',
      finding: `Next-day recovery after gym: ${gymEffect.with}%${gymEffect.without ? ' vs ' + gymEffect.without + '% on rest days' : ''}`,
      signal: gymEffect.with >= (gymEffect.without || 0) ? 'positive' : 'negative',
    })
  }

  if (saunaEffect?.with != null) {
    insights.push({
      icon: '🧖',
      label: 'Day after sauna',
      finding: `Next-day recovery after sauna: ${saunaEffect.with}%`,
      signal: saunaEffect.with >= 65 ? 'positive' : 'neutral',
    })
  }

  if (windDownEffect) {
    const delta = +(windDownEffect.good - windDownEffect.poor).toFixed(0)
    insights.push({
      icon: '😌',
      label: 'Wind-down quality',
      finding: `Good wind-down → ${windDownEffect.good}% recovery vs poor wind-down → ${windDownEffect.poor}% (${delta > 0 ? '+' : ''}${delta}%)`,
      signal: delta > 3 ? 'positive' : 'neutral',
    })
  }

  if (tempEffect) {
    const delta = +(tempEffect.cool - tempEffect.warm).toFixed(1)
    insights.push({
      icon: '❄',
      label: 'Room temperature',
      finding: `≤67°F → stability ${tempEffect.cool}/10 vs ≥70°F → ${tempEffect.warm}/10`,
      signal: delta > 0.5 ? 'positive' : 'neutral',
    })
  }

  if (dinnerEffect) {
    const delta = +(dinnerEffect.early - dinnerEffect.late).toFixed(1)
    insights.push({
      icon: '🍽',
      label: 'Dinner timing',
      finding: delta > 0.5
        ? `Eating before 19:00 → stability ${dinnerEffect.early}/10 vs after 20:00 → ${dinnerEffect.late}/10`
        : `No clear effect of dinner timing on sleep stability yet`,
      signal: delta > 0.5 ? 'positive' : 'neutral',
    })
  }

  if (topCauses.length > 0) {
    insights.push({
      icon: '⚡',
      label: 'Recurring disruption causes',
      finding: topCauses.map(([c, n]) => {
        const labels = { thyroid: 'Thyroid', stress: 'Stress', apnea: 'Apnea', temperature: 'Temperature', food: 'Food', caffeine: 'Caffeine', alcohol: 'Alcohol', mixed: 'Mixed' }
        return (labels[c] || c) + ' (' + n + 'x)'
      }).join(' · '),
      signal: topCauses[0]?.[0] === 'thyroid' ? 'info' : 'warning',
    })
  }

  if (stabilityTrend != null) {
    insights.push({
      icon: stabilityTrend >= 0 ? '📈' : '📉',
      label: 'Stability trend',
      finding: stabilityTrend >= 0
        ? `Sleep stability improved +${stabilityTrend} pts in last 14 nights vs prior 14`
        : `Sleep stability down ${Math.abs(stabilityTrend)} pts vs prior 14 nights`,
      signal: stabilityTrend >= 0 ? 'positive' : 'warning',
    })
  }

  if (!insights.length) return (
    <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text3)' }}>
      Keep logging — patterns will appear after a few more nights of data.
    </div>
  )

  const signalColor = { positive: 'var(--green)', negative: 'var(--red)', warning: 'var(--amber)', neutral: 'var(--text3)', info: 'var(--blue)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        🔬 {lang === 'de' ? 'Muster & Korrelationen' : 'Patterns & correlations'} · {total} {lang === 'de' ? 'Nächte' : 'nights'}
      </div>
      {insights.map((ins, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, borderLeft: '3px solid ' + (signalColor[ins.signal] || 'var(--border)') }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{ins.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 2 }}>{ins.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{ins.finding}</div>
          </div>
        </div>
      ))}
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

  // Evening fields can be on today's log OR yesterday's
  const eveningSource = log?.phone_away_time ? log : yesterdayLog

  // Compute wind-down duration: phone away → asleep
  let windDownMins = null
  if (eveningSource?.phone_away_time && bedTime) {
    const pm = parseInt(eveningSource.phone_away_time.split(':')[0])*60 + parseInt(eveningSource.phone_away_time.split(':')[1])
    let bm = parseInt(bedTime.split(':')[0])*60 + parseInt(bedTime.split(':')[1])
    if (bm < 360) bm += 1440  // after midnight
    const gap = bm - pm
    if (gap > 0 && gap < 600) windDownMins = gap  // sanity check: 0-10h range only
  }

  // Last night summary grid
  const summary = []
  if (eveningSource?.dinner_time) summary.push({ icon: '🍽', label: lang === 'de' ? 'Abendessen' : 'Dinner', value: eveningSource.dinner_time.slice(0,5) })
  if (eveningSource?.home_time) summary.push({ icon: '🏠', label: lang === 'de' ? 'Zuhause' : 'Home', value: eveningSource.home_time.slice(0,5) })
  if (eveningSource?.phone_away_time) summary.push({ icon: '📵', label: lang === 'de' ? 'Handy weg' : 'Phone away', value: eveningSource.phone_away_time.slice(0,5) })
  const hasEveningData = !!(eveningSource?.phone_away_time || eveningSource?.wind_down)
  summary.push({ icon: '🛏', label: lang === 'de' ? 'Eingeschlafen' : 'Asleep', value: bedTime ? bedTime.slice(0,5) : '—', pending: !bedTime && hasEveningData })
  summary.push({ icon: '⏱', label: lang === 'de' ? 'Wind-down' : 'Wind-down', value: windDownMins !== null ? `${windDownMins}min` : '—', pending: windDownMins === null && hasEveningData })
  if (log?.sleep_efficiency) summary.push({ icon: '📊', label: lang === 'de' ? 'Effizienz' : 'Efficiency', value: `${Math.round(log.sleep_efficiency)}%` })
  if (eveningSource?.wind_down) summary.push({ icon: eveningSource.wind_down === 'good' ? '😌' : eveningSource.wind_down === 'ok' ? '😐' : '😣', label: lang === 'de' ? 'Qualität' : 'Quality', value: eveningSource.wind_down })
  if (eveningSource?.ac_temp) summary.push({ icon: '❄', label: 'AC', value: `${eveningSource.ac_temp}°F` })

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Last night summary */}
      {summary.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {lang === 'de' ? 'Letzte Nacht' : 'Last night'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {summary.map((s, i) => (
              <div key={i} style={{ background: s.pending ? 'transparent' : 'var(--surface2)', borderRadius: 8, padding: '7px 8px', textAlign: 'center', border: s.pending ? '1.5px dashed var(--border)' : 'none', opacity: s.pending ? 0.5 : 1 }}>
                <div style={{ fontSize: 14, marginBottom: 2 }}>{s.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.pending ? 'var(--text3)' : 'var(--text)' }}>{s.value}</div>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Sleep stats history */}
      <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
        <SleepStatsCard userId={session.user.id} lang={lang} />
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
- Recommendation: ${hrData.recommendation || 'n/a'}` : ''

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
