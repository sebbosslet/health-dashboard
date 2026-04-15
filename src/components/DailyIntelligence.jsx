import { useState, useEffect } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

// ─── AI Analysis Engine ───────────────────────────────────────────────────────

async function generateDailyInsight(todayLog, yesterdayLog, historicalLogs, lang) {
  const today = format(new Date(), 'd MMM yyyy')

  // Build pattern analysis from historical data
  const phoneDelays = historicalLogs
    .filter(l => l.phone_away_time && l.sleep_efficiency)
    .map(l => {
      const phoneMin = parseInt(l.phone_away_time?.split(':')[0]) * 60 + parseInt(l.phone_away_time?.split(':')[1] || 0)
      const bedMin = l.bed_time ? parseInt(l.bed_time?.split(':')[0]) * 60 + parseInt(l.bed_time?.split(':')[1] || 0) : null
      return { gap: bedMin ? bedMin - phoneMin : null, efficiency: l.sleep_efficiency, recovery: l.recovery_score }
    })
    .filter(d => d.gap !== null && d.gap > 0)

  const avgGapShort = phoneDelays.filter(d => d.gap < 45).reduce((a, d, _, arr) => a + d.efficiency / arr.length, 0)
  const avgGapLong = phoneDelays.filter(d => d.gap >= 45).reduce((a, d, _, arr) => a + d.efficiency / arr.length, 0)

  const gymDays = historicalLogs.filter(l => l.activity?.includes('gym'))
  const gymRecovery = gymDays.map(l => {
    const nextDay = historicalLogs.find(n => n.date === format(new Date(new Date(l.date).getTime() + 86400000), 'yyyy-MM-dd'))
    return nextDay?.recovery_score
  }).filter(Boolean)
  const avgGymNextDayRecovery = gymRecovery.length ? Math.round(gymRecovery.reduce((a, v) => a + v, 0) / gymRecovery.length) : null

  const saunaDays = historicalLogs.filter(l => l.activity?.includes('sauna'))
  const saunaRecovery = saunaDays.map(l => {
    const nextDay = historicalLogs.find(n => n.date === format(new Date(new Date(l.date).getTime() + 86400000), 'yyyy-MM-dd'))
    return nextDay?.recovery_score
  }).filter(Boolean)
  const avgSaunaNextDayRecovery = saunaRecovery.length ? Math.round(saunaRecovery.reduce((a, v) => a + v, 0) / saunaRecovery.length) : null

  const patternContext = `
PERSONAL PATTERNS (last ${historicalLogs.length} days of your data):
- Phone-away < 45min before bed → avg sleep efficiency: ${avgGapShort ? Math.round(avgGapShort) + '%' : 'insufficient data'}
- Phone-away ≥ 45min before bed → avg sleep efficiency: ${avgGapLong ? Math.round(avgGapLong) + '%' : 'insufficient data'}
- Day after gym → avg recovery score: ${avgGymNextDayRecovery ? avgGymNextDayRecovery + '%' : 'insufficient data'}
- Day after sauna → avg recovery score: ${avgSaunaNextDayRecovery ? avgSaunaNextDayRecovery + '%' : 'insufficient data'}
- Total days tracked: ${historicalLogs.length}
`

  const yesterdayContext = yesterdayLog ? `
YESTERDAY (${format(new Date(yesterdayLog.date), 'd MMM')}):
- Activities: ${yesterdayLog.activity?.join(', ') || 'none logged'}
- Evening habits: ${yesterdayLog.habits?.join(', ') || 'none logged'}
- Phone away: ${yesterdayLog.phone_away_time || 'not logged'}
- Bed time: ${yesterdayLog.bed_time || 'not logged'}
- Wind-down quality: ${yesterdayLog.wind_down || 'not logged'}
- Calories: ${yesterdayLog.calories || 'not logged'}
- Evening note: ${yesterdayLog.evening_note || 'none'}
` : 'No data for yesterday'

  const todayContext = `
TODAY'S WHOOP DATA:
- Recovery score: ${todayLog.recovery_score || 'not yet synced'}%
- Sleep duration: ${todayLog.sleep_duration ? (todayLog.sleep_duration).toFixed(1) + 'h' : 'not yet synced'}
- Sleep efficiency: ${todayLog.sleep_efficiency || 'not yet synced'}%
- HRV: ${todayLog.hrv || 'not yet synced'}ms
- RHR: ${todayLog.rhr || 'not yet synced'}bpm
- Restorative sleep: ${todayLog.sleep_restorative ? (todayLog.sleep_restorative).toFixed(1) + 'h' : 'not yet synced'}
- How you feel: Energy ${todayLog.morning_energy || '?'}/5, Mood ${todayLog.morning_mood || '?'}/5, Soreness ${todayLog.morning_soreness || '?'}/5
- Morning note: ${todayLog.morning_note || 'none'}
`

  const prompt = lang === 'de'
    ? `Du bist ein persönlicher Gesundheitscoach mit Zugang zu Sebastian's Gesundheitsdaten. Analysiere die heutigen Morgen-Daten im Kontext von gestern und seinen persönlichen Mustern.

${patternContext}
${yesterdayContext}
${todayContext}

Schreibe eine direkte, persönliche Analyse (3-5 Sätze). Nenne konkrete Verbindungen die du siehst. Stelle eine clevere Frage am Ende. Sei wie ein erfahrener Coach - direkt, nicht lobend, konkret.`
    : `You are Sebastian's personal health coach with access to his health data. Analyse today's morning data in context of yesterday and his personal patterns.

${patternContext}
${yesterdayContext}
${todayContext}

Write a direct, personal analysis (3-5 sentences). Name specific connections you see in the data. Ask one smart follow-up question at the end. Be like an experienced coach — direct, not sycophantic, concrete. If data is missing, note what would make the analysis sharper.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ─── Morning Check-in ─────────────────────────────────────────────────────────

function MorningCheckin({ log, onSave, lang }) {
  const [energy, setEnergy] = useState(log?.morning_energy || 0)
  const [mood, setMood] = useState(log?.morning_mood || 0)
  const [soreness, setSoreness] = useState(log?.morning_soreness || 0)
  const [note, setNote] = useState(log?.morning_note || '')
  const [saving, setSaving] = useState(false)

  const labels = {
    en: { energy: 'Energy', mood: 'Mood', soreness: 'Soreness', note: 'Anything specific?', save: 'Save check-in', saving: 'Saving...' },
    de: { energy: 'Energie', mood: 'Stimmung', soreness: 'Muskelkater', note: 'Etwas Besonderes?', save: 'Einchecken', saving: 'Speichern...' }
  }
  const l = labels[lang] || labels.en

  const emojis = {
    energy: ['', '😴', '😑', '😐', '🙂', '⚡'],
    mood: ['', '😞', '😕', '😐', '😊', '😄'],
    soreness: ['', '🔴', '🟠', '🟡', '🟢', '✅'],
  }

  async function handleSave() {
    setSaving(true)
    await onSave({ morning_energy: energy, morning_mood: mood, morning_soreness: soreness, morning_note: note })
    setSaving(false)
    showToast(lang === 'de' ? 'Check-in gespeichert' : 'Check-in saved')
  }

  const complete = energy > 0 && mood > 0 && soreness > 0

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[
        { label: l.energy, val: energy, set: setEnergy, key: 'energy' },
        { label: l.mood, val: mood, set: setMood, key: 'mood' },
        { label: l.soreness, val: soreness, set: setSoreness, key: 'soreness' },
      ].map(item => (
        <div key={item.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{item.label}</span>
            <span style={{ fontSize: 16 }}>{item.val > 0 ? emojis[item.key][item.val] : '—'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} onClick={() => item.set(v)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${item.val === v ? 'var(--green)' : 'var(--border)'}`,
                background: item.val === v ? 'var(--green-light)' : 'var(--surface2)',
                color: item.val === v ? 'var(--green)' : 'var(--text2)',
                fontWeight: item.val === v ? 700 : 400, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit'
              }}>{v}</button>
            ))}
          </div>
        </div>
      ))}

      <div>
        <input
          className="field-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={l.note}
          style={{ fontSize: 13 }}
        />
      </div>

      <button className="btn-primary" onClick={handleSave} disabled={saving || !complete}>
        {saving ? l.saving : l.save}
      </button>
    </div>
  )
}

// ─── Evening Log ──────────────────────────────────────────────────────────────

function EveningLog({ log, onSave, lang }) {
  const [phoneAway, setPhoneAway] = useState(log?.phone_away_time?.slice(0,5) || '')
  const [bedTime, setBedTime] = useState(log?.bed_time?.slice(0,5) || '')
  const [windDown, setWindDown] = useState(log?.wind_down || '')
  const [note, setNote] = useState(log?.evening_note || '')
  const [saving, setSaving] = useState(false)

  const labels = {
    en: { phoneAway: 'Phone away at', bedTime: 'In bed at', windDown: 'Wind-down quality', note: 'Anything affect your evening?', save: 'Log evening', saving: 'Saving...', good: 'Good', ok: 'OK', poor: 'Poor' },
    de: { phoneAway: 'Handy weggelegt um', bedTime: 'Im Bett um', windDown: 'Abend-Qualität', note: 'Etwas Besonderes heute Abend?', save: 'Abend speichern', saving: 'Speichern...', good: 'Gut', ok: 'OK', poor: 'Schlecht' }
  }
  const l = labels[lang] || labels.en

  async function handleSave() {
    setSaving(true)
    await onSave({
      phone_away_time: phoneAway || null,
      bed_time: bedTime || null,
      wind_down: windDown || null,
      evening_note: note || null,
    })
    setSaving(false)
    showToast(lang === 'de' ? 'Abend gespeichert' : 'Evening logged')
  }

  const phoneMin = phoneAway ? parseInt(phoneAway.split(':')[0]) * 60 + parseInt(phoneAway.split(':')[1]) : null
  const bedMin = bedTime ? parseInt(bedTime.split(':')[0]) * 60 + parseInt(bedTime.split(':')[1]) : null
  const gap = phoneMin && bedMin ? bedMin - phoneMin : null

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field">
          <label className="field-label">{l.phoneAway}</label>
          <input className="field-input" type="time" value={phoneAway} onChange={e => setPhoneAway(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">{l.bedTime}</label>
          <input className="field-input" type="time" value={bedTime} onChange={e => setBedTime(e.target.value)} />
        </div>
      </div>

      {gap !== null && gap > 0 && (
        <div style={{ background: gap >= 45 ? 'var(--green-light)' : 'var(--amber-light)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: gap >= 45 ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
          {gap >= 45 ? '✓' : '⚠'} {gap} min {lang === 'de' ? 'zwischen Handy und Bett' : 'gap between phone and bed'}
          {gap < 45 && (lang === 'de' ? ' — dein Ziel ist 45min' : ' — your target is 45min')}
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{l.windDown}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['good', l.good, '😌'], ['ok', l.ok, '😐'], ['poor', l.poor, '😣']].map(([val, label, emoji]) => (
            <button key={val} onClick={() => setWindDown(val)} style={{
              flex: 1, padding: '9px', borderRadius: 8,
              border: `1.5px solid ${windDown === val ? 'var(--green)' : 'var(--border)'}`,
              background: windDown === val ? 'var(--green-light)' : 'var(--surface2)',
              color: windDown === val ? 'var(--green)' : 'var(--text2)',
              fontWeight: windDown === val ? 700 : 400, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
            }}>{emoji} {label}</button>
          ))}
        </div>
      </div>

      <input className="field-input" value={note} onChange={e => setNote(e.target.value)} placeholder={l.note} style={{ fontSize: 13 }} />

      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? l.saving : l.save}
      </button>
    </div>
  )
}

// ─── AI Insight Card ──────────────────────────────────────────────────────────

function InsightCard({ log, userId, lang }) {
  const [insight, setInsight] = useState(log?.ai_insight || '')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(!!log?.ai_insight)
  const today = format(new Date(), 'yyyy-MM-dd')

  async function generateInsight() {
    setLoading(true)
    try {
      // Fetch yesterday's log
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
      const { data: yesterdayLog } = await supabase
        .from('daily_logs').select('*').eq('user_id', userId).eq('date', yesterday).maybeSingle()

      // Fetch last 30 days for pattern analysis
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
      const { data: history } = await supabase
        .from('daily_logs').select('*').eq('user_id', userId)
        .gte('date', thirtyDaysAgo).lt('date', today)
        .order('date', { ascending: true })

      const text = await generateDailyInsight(log, yesterdayLog, history || [], lang)
      setInsight(text)
      setExpanded(true)

      // Save insight to today's log
      await supabase.from('daily_logs').upsert({
        user_id: userId, date: today, ai_insight: text, ai_insight_date: today,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })
    } catch (e) {
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setLoading(false)
  }

  const hasCheckin = log?.morning_energy || log?.morning_mood
  const hasWhoop = log?.recovery_score || log?.sleep_duration

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {insight && expanded ? (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{insight}</div>
          <button onClick={() => generateInsight()} disabled={loading} style={{ marginTop: 10, padding: '6px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
            {loading ? '...' : lang === 'de' ? '↺ Neu analysieren' : '↺ Re-analyse'}
          </button>
        </div>
      ) : (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!hasWhoop && !hasCheckin && (
            <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              {lang === 'de'
                ? 'Sync WHOOP und fülle den Check-in aus für eine vollständige Analyse.'
                : 'Sync WHOOP and complete the morning check-in for a full analysis.'}
            </div>
          )}
          <button className="btn-primary" onClick={generateInsight} disabled={loading}>
            {loading
              ? (lang === 'de' ? 'Analysiere...' : 'Analysing...')
              : (lang === 'de' ? '✨ Meinen Tag analysieren' : '✨ Analyse my day')}
          </button>
          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 }}>
            {lang === 'de'
              ? 'Liest deine WHOOP-Daten, gestrigen Abend und 30 Tage Muster'
              : 'Reads your WHOOP data, last evening, and 30-day patterns'}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function DailyIntelligence({ session, log, onSave }) {
  const { lang } = useLang()
  const [section, setSection] = useState(null) // 'morning' | 'evening' | 'insight'
  const today = new Date()
  const hour = today.getHours()

  // Default to appropriate section based on time of day
  const defaultSection = hour < 12 ? 'morning' : hour >= 20 ? 'evening' : 'insight'

  const hasMorning = log?.morning_energy > 0
  const hasEvening = log?.phone_away_time || log?.bed_time || log?.wind_down

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          {lang === 'de' ? '🧠 Tages-Analyse' : '🧠 Daily Intelligence'}
        </span>
        {hasMorning && hasEvening && (
          <span className="badge badge-green">{lang === 'de' ? 'Komplett' : 'Complete'}</span>
        )}
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
        {[
          { key: 'morning', label: lang === 'de' ? '🌅 Morgen' : '🌅 Morning', done: hasMorning },
          { key: 'evening', label: lang === 'de' ? '🌙 Abend' : '🌙 Evening', done: hasEvening },
          { key: 'insight', label: lang === 'de' ? '✨ Analyse' : '✨ Insight', done: !!log?.ai_insight },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setSection(section === s.key ? null : s.key)}
            style={{
              flex: 1, padding: '9px 4px', background: 'none', border: 'none',
              borderBottom: `2px solid ${section === s.key ? 'var(--green)' : 'transparent'}`,
              color: section === s.key ? 'var(--green)' : 'var(--text2)',
              fontSize: 11, fontWeight: section === s.key ? 700 : 400,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            {s.label}
            {s.done && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />}
          </button>
        ))}
      </div>

      {section === 'morning' && (
        <MorningCheckin log={log} onSave={onSave} lang={lang} />
      )}
      {section === 'evening' && (
        <EveningLog log={log} onSave={onSave} lang={lang} />
      )}
      {section === 'insight' && (
        <InsightCard log={log} userId={session.user.id} lang={lang} />
      )}

      {!section && (
        <div style={{ padding: '10px 14px 12px', display: 'flex', gap: 6 }}>
          <button onClick={() => setSection(defaultSection)} style={{ flex: 1, padding: '9px', borderRadius: 8, background: 'var(--green-light)', border: 'none', color: 'var(--green)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            {defaultSection === 'morning' ? (lang === 'de' ? '🌅 Morgen-Check-in' : '🌅 Morning check-in') :
             defaultSection === 'evening' ? (lang === 'de' ? '🌙 Abend loggen' : '🌙 Log evening') :
             (lang === 'de' ? '✨ Analyse starten' : '✨ Get insight')}
          </button>
        </div>
      )}
    </div>
  )
}
