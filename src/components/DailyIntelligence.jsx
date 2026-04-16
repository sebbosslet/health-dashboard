import { useState, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

// ─── AI Analysis Engine ───────────────────────────────────────────────────────

async function generateDailyInsight(todayLog, yesterdayLog, historicalLogs, lang, yesterdayEvents, todayEvents, travelState, caffeineMeals = []) {
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
    ? `\n- Caffeine: ${caffeineMeals.map(m => `${m.meal_name}${m.consumed_at ? ` at ${m.consumed_at.slice(0,5)} (50% cleared ~${String((parseInt(m.consumed_at.split(':')[0])+5)%24).padStart(2,'0')}:${m.consumed_at.slice(3,5)})` : ''}`).join(', ')}`
    : '\n- Caffeine: none logged'

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
- Phone away at: ${yesterdayLog.phone_away_time?.slice(0,5) || 'not logged'}
- In bed at: ${yesterdayLog.bed_time?.slice(0,5) || 'not logged'}
- Phone-to-bed gap: ${yesterdayLog.phone_away_time && yesterdayLog.bed_time
    ? (() => {
        const pm = parseInt(yesterdayLog.phone_away_time.split(':')[0])*60 + parseInt(yesterdayLog.phone_away_time.split(':')[1])
        let bm = parseInt(yesterdayLog.bed_time.split(':')[0])*60 + parseInt(yesterdayLog.bed_time.split(':')[1])
        if (bm < 360) bm += 1440 // after midnight
        return (bm - pm) + 'min'
      })()
    : 'not calculable'}
- Wind-down quality: ${yesterdayLog.wind_down || 'not logged'}
- Dinner time: ${yesterdayLog.dinner_time?.slice(0,5) || 'not logged'}
- AC temperature: ${yesterdayLog.ac_temp ? yesterdayLog.ac_temp + '°F' : 'not logged'}
- Calories: ${yesterdayLog.calories ? yesterdayLog.calories + ' kcal' : 'not logged'}
- Evening note: ${yesterdayLog.evening_note || 'none'}${eventsContext}${caffeineContext}${travelContext}
` : 'No evening log for yesterday'

  const todayContext = `
THIS MORNING (${format(new Date(), 'd MMM')} — result of that sleep):
- Recovery: ${todayLog.recovery_score ? todayLog.recovery_score + '%' : 'not synced'}
- Sleep duration: ${todayLog.sleep_duration ? todayLog.sleep_duration.toFixed(1) + 'h' : 'not synced'}
- Sleep efficiency: ${todayLog.sleep_efficiency ? todayLog.sleep_efficiency + '%' : 'not synced'}
- HRV: ${todayLog.hrv ? todayLog.hrv + 'ms' : 'not synced'}
- RHR: ${todayLog.rhr ? todayLog.rhr + 'bpm' : 'not synced'}
- Restorative sleep: ${todayLog.sleep_restorative ? todayLog.sleep_restorative.toFixed(1) + 'h' : 'not synced'}
- How you feel: Energy ${todayLog.morning_energy || '?'}/5, Mood ${todayLog.morning_mood || '?'}/5, Soreness ${todayLog.morning_soreness || '?'}/5
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

Write 3-5 direct sentences. Concretely connect what happened yesterday evening with today's WHOOP outcome. Reference his personal patterns when relevant. Ask one smart follow-up question at the end. Be like an experienced coach — direct, honest, not excessively positive. If key data is missing, say specifically what would sharpen the analysis.`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ─── Morning Check-in ─────────────────────────────────────────────────────────

function MorningCheckin({ log, onSave, lang, yesterdayLog }) {
  const [energy, setEnergy] = useState(log?.morning_energy || 0)
  const [mood, setMood] = useState(log?.morning_mood || 0)
  const [soreness, setSoreness] = useState(log?.morning_soreness || 0)
  const [note, setNote] = useState(log?.morning_note || '')
  const [bedTime, setBedTime] = useState(log?.bed_time?.slice(0,5) || '')
  const [saving, setSaving] = useState(false)

  // Re-sync when log fields change
  useEffect(() => {
    setEnergy(log?.morning_energy || 0)
    setMood(log?.morning_mood || 0)
    setSoreness(log?.morning_soreness || 0)
    setNote(log?.morning_note || '')
    setBedTime(log?.bed_time?.slice(0,5) || '')
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
    await onSave({ morning_energy: energy, morning_mood: mood, morning_soreness: soreness, morning_note: note || null, bed_time: bedTime || null })
    setSaving(false)
    showToast(lang === 'de' ? 'Check-in gespeichert' : 'Check-in saved')
  }

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Yesterday evening context */}
      {!!yesterdayLog && !!(yesterdayLog.phone_away_time || yesterdayLog.wind_down || (yesterdayLog.habits?.length > 0)) && (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>
            {lang === 'de' ? 'Gestern Abend' : 'Last evening'}
          </span>
          {' · '}
          <span>{[
            yesterdayLog.phone_away_time ? `📵 ${yesterdayLog.phone_away_time.slice(0,5)}` : null,
            yesterdayLog.bed_time ? `🛏 ${yesterdayLog.bed_time.slice(0,5)}` : null,
            yesterdayLog.wind_down ? `${yesterdayLog.wind_down === 'good' ? '😌' : yesterdayLog.wind_down === 'ok' ? '😐' : '😣'} ${yesterdayLog.wind_down}` : null,
            yesterdayLog.habits?.length > 0 ? `${yesterdayLog.habits.length} ${lang === 'de' ? 'Gewohnheiten' : 'habits'}` : null,
          ].filter(Boolean).join(' · ')}</span>
        </div>
      )}

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

      {/* Sleep onset — auto-populated from WHOOP screenshot */}
      {bedTime ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--green-light)', borderRadius: 8 }}>
          <span style={{ fontSize: 14 }}>🛏</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
              {lang === 'de' ? 'Einschlafzeit' : 'Sleep onset'}: {bedTime}
            </div>
            <div style={{ fontSize: 10, color: 'var(--green)', opacity: 0.8 }}>
              {lang === 'de' ? 'Automatisch aus WHOOP Screenshot' : 'Auto-extracted from WHOOP screenshot'}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}>
          🛏 {lang === 'de' ? 'Einschlafzeit wird automatisch aus dem WHOOP Screenshot übernommen' : 'Sleep onset auto-extracted when you upload your WHOOP screenshot'}
        </div>
      )}

      <button className="btn-primary" onClick={handleSave} disabled={saving || !energy || !mood || !soreness}>
        {saving ? labels.saving : labels.save}
      </button>
    </div>
  )
}

// ─── Evening Log (merged with habits) ────────────────────────────────────────

function EveningLog({ log, onSave, lang, habitGoals, activeHabits, onToggleHabit }) {
  const [phoneAway, setPhoneAway] = useState(log?.phone_away_time?.slice(0,5) || '')
  const [windDown, setWindDown] = useState(log?.wind_down || '')
  const [note, setNote] = useState(log?.evening_note || '')
  const [dinnerTime, setDinnerTime] = useState(log?.dinner_time?.slice(0,5) || '')
  const [acTemp, setAcTemp] = useState(log?.ac_temp || '')
  const [saving, setSaving] = useState(false)

  // Re-sync when log fields change
  useEffect(() => {
    setPhoneAway(log?.phone_away_time?.slice(0,5) || '')
    setWindDown(log?.wind_down || '')
    setNote(log?.evening_note || '')
    setDinnerTime(log?.dinner_time?.slice(0,5) || '')
    setAcTemp(log?.ac_temp != null ? String(log.ac_temp) : '')
  }, [log?.phone_away_time, log?.wind_down, log?.evening_note, log?.dinner_time, log?.ac_temp])

  const labels = lang === 'de'
    ? { habits: 'Abendgewohnheiten', phone: 'Handy weggelegt um', wind: 'Abend-Qualität', note: 'Etwas Besonderes?', save: 'Abend speichern', saving: 'Speichern...', good: 'Gut', ok: 'OK', poor: 'Schlecht', dinner: 'Abendessen um', ac: 'AC-Temp (°F)' }
    : { habits: 'Evening habits', phone: 'Phone away at', wind: 'Wind-down quality', note: 'Anything affect your evening?', save: 'Save evening', saving: 'Saving...', good: 'Good', ok: 'OK', poor: 'Poor', dinner: 'Dinner at', ac: 'AC temp (°F)' }

  async function handleSave() {
    setSaving(true)
    await onSave({
      phone_away_time: phoneAway || null,
      wind_down: windDown || null,
      evening_note: note || null,
      dinner_time: dinnerTime || null,
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
              return (
                <button key={key} className={`toggle-btn ${activeHabits.has(key) ? 'active' : ''}`} onClick={() => onToggleHabit(key)}>
                  {getEmoji(h.name)} {h.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Evening time fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field">
          <label className="field-label">📵 {labels.phone}</label>
          <input key={`phone-${phoneAway}`} className="field-input" type="time" defaultValue={phoneAway} onChange={e => setPhoneAway(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">🍽 {labels.dinner}</label>
          <input key={`dinner-${dinnerTime}`} className="field-input" type="time" defaultValue={dinnerTime} onChange={e => setDinnerTime(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">❄ {labels.ac}</label>
          <input className="field-input" type="number" step="1" value={acTemp} onChange={e => setAcTemp(e.target.value)} placeholder="68" inputMode="numeric" />
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

// ─── AI Insight ───────────────────────────────────────────────────────────────

function InsightCard({ log, userId, lang }) {
  const [insight, setInsight] = useState(log?.ai_insight || '')
  const [loading, setLoading] = useState(false)
  const today = format(new Date(), 'yyyy-MM-dd')

  async function generateInsight() {
    setLoading(true)
    try {
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')

      const [{ data: yesterdayLog }, { data: history }, { data: yesterdayEvents }, { data: travelState }, { data: caffeineMeals }] = await Promise.all([
        supabase.from('daily_logs').select('*').eq('user_id', userId).eq('date', yesterday).maybeSingle(),
        supabase.from('daily_logs').select('*').eq('user_id', userId).gte('date', thirtyDaysAgo).lt('date', today).order('date', { ascending: true }),
        supabase.from('daily_events').select('*').eq('user_id', userId).eq('date', yesterday),
        supabase.from('travel_state').select('*').eq('user_id', userId).eq('active', true).maybeSingle(),
        supabase.from('meal_logs').select('meal_name,consumed_at').eq('user_id', userId).eq('date', yesterday).eq('is_caffeinated', true),
      ])

      const text = await generateDailyInsight(log, yesterdayLog, history || [], lang, yesterdayEvents || [], [], travelState, caffeineMeals || [])
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

  // Show yesterday's evening context in the insight header
  const yesterdayDate = format(subDays(new Date(), 1), 'd MMM')
  const todayDate = format(new Date(), 'd MMM')

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Context banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text3)' }}>
        <span style={{ padding: '2px 8px', background: 'var(--surface2)', borderRadius: 10 }}>
          {lang === 'de' ? `Abend ${yesterdayDate}` : `Evening ${yesterdayDate}`}
        </span>
        <svg width="16" height="8" viewBox="0 0 16 8" fill="none"><path d="M0 4h14M10 1l4 3-4 3" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{ padding: '2px 8px', background: 'var(--green-light)', borderRadius: 10, color: 'var(--green)', fontWeight: 600 }}>
          {lang === 'de' ? `WHOOP ${todayDate}` : `WHOOP ${todayDate}`}
        </span>
      </div>

      {insight ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{insight}</div>
          <button onClick={generateInsight} disabled={loading} style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' }}>
            {loading ? '...' : (lang === 'de' ? '↺ Neu analysieren' : '↺ Re-analyse')}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
            {lang === 'de'
              ? `Verbindet deinen Abend vom ${yesterdayDate} mit deinen WHOOP-Daten von heute. Liest deine 30-Tage-Muster für persönliche Korrelationen.`
              : `Connects your evening of ${yesterdayDate} with today's WHOOP data. Reads your 30-day patterns for personal correlations.`}
          </div>
          <button className="btn-primary" onClick={generateInsight} disabled={loading}>
            {loading
              ? (lang === 'de' ? 'Analysiere...' : 'Analysing...')
              : (lang === 'de' ? '✨ Meinen Tag analysieren' : '✨ Analyse my day')}
          </button>
        </>
      )}
    </div>
  )
}

// ─── Emoji helper ─────────────────────────────────────────────────────────────

const EMOJI_MAP = {
  reading: '📚', meditation: '🧘', nophone: '📵', journal: '✍️', no_phone: '📵',
  stretch: '🙆', gratitude: '🙏', cold: '🧊', walk: '🚶', yoga: '🧘',
}

function getEmoji(name) {
  const lower = name.toLowerCase().replace(/\s+/g, '_')
  for (const [key, emoji] of Object.entries(EMOJI_MAP)) {
    if (lower.includes(key)) return emoji
  }
  return '•'
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DailyIntelligence({ session, log, onSave, habitGoals, activeHabits, onToggleHabit }) {
  const { lang } = useLang()
  const [section, setSection] = useState(null)
  const [yesterdayLog, setYesterdayLog] = useState(null)
  const hour = new Date().getHours()

  // Fetch yesterday's log for morning context
  useEffect(() => {
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
    supabase.from('daily_logs').select('*').eq('user_id', session.user.id).eq('date', yesterday).maybeSingle()
      .then(({ data }) => setYesterdayLog(data))
  }, [session.user.id])

  // Smart default section based on time of day
  const defaultSection = hour < 13 ? 'morning' : 'evening'

  const hasMorning = log?.morning_energy > 0
  const hasEvening = !!(log?.phone_away_time || log?.bed_time || log?.wind_down || (log?.habits?.length > 0))
  const hasInsight = !!log?.ai_insight

  const sections = [
    { key: 'morning', label: lang === 'de' ? '🌅 Morgen' : '🌅 Morning', done: hasMorning },
    { key: 'evening', label: lang === 'de' ? '🌙 Abend' : '🌙 Evening', done: hasEvening },
    { key: 'insight', label: '✨ Insight', done: hasInsight },
  ]

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">🧠 {lang === 'de' ? 'Tages-Analyse' : 'Daily Intelligence'}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {[hasMorning, hasEvening, hasInsight].filter(Boolean).length}/3
        </span>
      </div>

      {/* Tab row */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
        {sections.map(s => (
          <button key={s.key} onClick={() => setSection(section === s.key ? null : s.key)} style={{
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

      {section === 'morning' && (
        <MorningCheckin log={log} onSave={onSave} lang={lang} yesterdayLog={yesterdayLog} />
      )}
      {section === 'evening' && (
        <EveningLog
          log={log}
          onSave={(fields) => onSave({ ...fields, habits: Array.from(activeHabits) })}
          lang={lang}
          habitGoals={habitGoals} activeHabits={activeHabits} onToggleHabit={onToggleHabit}
        />
      )}
      {section === 'insight' && (
        <InsightCard log={log} userId={session.user.id} lang={lang} />
      )}

      {!section && (
        <div style={{ padding: '10px 14px 12px', display: 'flex', gap: 8 }}>
          <button onClick={() => setSection('morning')} style={{
            flex: 1, padding: '9px', borderRadius: 8,
            background: hasMorning ? 'var(--surface2)' : 'var(--green-light)',
            border: `0.5px solid ${hasMorning ? 'var(--border)' : 'var(--green)'}`,
            color: hasMorning ? 'var(--text2)' : 'var(--green)',
            fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            🌅 {lang === 'de' ? 'Morgen' : 'Morning'}
            {hasMorning && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />}
          </button>
          <button onClick={() => setSection('evening')} style={{
            flex: 1, padding: '9px', borderRadius: 8,
            background: hasEvening ? 'var(--surface2)' : 'var(--green-light)',
            border: `0.5px solid ${hasEvening ? 'var(--border)' : 'var(--green)'}`,
            color: hasEvening ? 'var(--text2)' : 'var(--green)',
            fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            🌙 {lang === 'de' ? 'Abend' : 'Evening'}
            {hasEvening && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />}
          </button>
        </div>
      )}
    </div>
  )
}
