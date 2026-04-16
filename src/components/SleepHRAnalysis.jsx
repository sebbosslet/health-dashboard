import { useState, useEffect, useRef } from 'react'
import { format, subDays, startOfWeek } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

// ─── Claude vision analysis ───────────────────────────────────────────────────

async function analyseSleepHRScreenshot(base64, mimeType, dateStr, contextLog, recentAnalyses, lang) {
  const historyContext = recentAnalyses.length >= 3
    ? `PREVIOUS NIGHTS FOR COMPARISON:\n` + recentAnalyses.slice(0, 7).map(a =>
        `- ${a.date}: baseline ${a.hr_baseline}bpm, ${a.spike_count} spikes, stability ${a.stability_score}/10, Y-axis ${a.axis_min}-${a.axis_max}bpm, dinner: ${a.dinner_time || 'unknown'}, AC: ${a.ac_temp || 'unknown'}`
      ).join('\n')
    : 'No previous nights to compare yet — this is the first upload.'

  const dayContext = contextLog ? `
DAY CONTEXT FOR ${dateStr}:
- Activities: ${contextLog.activity?.join(', ') || 'none'}
- Evening habits: ${contextLog.habits?.join(', ') || 'none'}
- Phone away: ${contextLog.phone_away_time?.slice(0,5) || 'unknown'}
- Bed time: ${contextLog.bed_time?.slice(0,5) || 'unknown'}
- Dinner time: ${contextLog.dinner_time || 'not logged'}
- AC temperature: ${contextLog.ac_temp ? contextLog.ac_temp + '°C' : 'not logged'}
- Wind-down: ${contextLog.wind_down || 'not logged'}
- Calories: ${contextLog.calories || 'unknown'}
- Evening note: ${contextLog.evening_note || 'none'}` : ''

  const prompt = `You are a sleep medicine expert analysing a WHOOP heart rate screenshot from sleep on ${dateStr}.

CRITICAL — fix the scale distortion problem first:
1. Read the Y-axis BPM labels to get actual absolute values
2. Note the full scale range (axis_max - axis_min)
3. A 5bpm spike on a 40-80bpm scale = harmless. On a 50-55bpm scale = significant
4. Always report absolute BPM, never relative positions
${dayContext}
${historyContext}

Analyse for these specific patterns:
- THYROID over-medication: sustained elevated baseline (>60bpm), gradual multi-minute elevations, higher overall HR floor
- STRESS/CORTISOL: elevated baseline throughout, HR never fully dropping, worse in first half
- SLEEP APNEA: sharp sudden spikes (>15bpm) at irregular intervals, quick return to baseline, repetitive pattern
- TEMPERATURE: gradually rising HR through night, elevated in second half
- LATE EATING: elevated first 2-3 hours then settling

Respond ONLY with valid JSON (no markdown):
{
  "hr_baseline": number,
  "hr_min": number,
  "hr_max": number,
  "hr_range": number,
  "axis_min": number,
  "axis_max": number,
  "spike_count": number,
  "spike_avg_magnitude": number,
  "spike_max_magnitude": number,
  "stable_pct": number,
  "fragmented_pct": number,
  "stability_score": number,
  "likely_cause": "thyroid|stress|apnea|temperature|food|mixed|unclear",
  "cause_confidence": "low|medium|high",
  "cause_reasoning": "1-2 sentences on why this pattern points to that cause",
  "micro_arousals_likely": true|false,
  "micro_arousal_count": number or null,
  "analysis": "3-4 direct sentences in plain English. State absolute numbers. Is this concerning or normal? What caused it? What does it mean for today?",
  "eye_bag_risk": "low|medium|high",
  "recommendation": "one concrete actionable recommendation for tonight"
}`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  })
  const data = await res.json()
  const text = data.content?.[0]?.text || ''
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

async function generateWeeklySleepReport(analyses, recentLogs, lang) {
  if (analyses.length < 3) return null

  const avgStability = +(analyses.reduce((a, n) => a + n.stability_score, 0) / analyses.length).toFixed(1)
  const avgSpikes = +(analyses.reduce((a, n) => a + n.spike_count, 0) / analyses.length).toFixed(1)
  const avgBaseline = +(analyses.reduce((a, n) => a + n.hr_baseline, 0) / analyses.length).toFixed(0)

  const causeCounts = analyses.reduce((acc, a) => {
    acc[a.likely_cause] = (acc[a.likely_cause] || 0) + 1
    return acc
  }, {})
  const dominantCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  const dinnerCorrelation = analyses
    .filter(a => a.dinner_time && a.stability_score)
    .map(a => {
      const hour = parseInt(a.dinner_time.split(':')[0])
      return { late: hour >= 20, stability: a.stability_score }
    })
  const lateDinnerAvg = dinnerCorrelation.filter(d => d.late).reduce((a, d, _, arr) => a + d.stability / arr.length, 0)
  const earlyDinnerAvg = dinnerCorrelation.filter(d => !d.late).reduce((a, d, _, arr) => a + d.stability / arr.length, 0)

  const acCorrelation = analyses
    .filter(a => a.ac_temp && a.stability_score)
    .map(a => ({ temp: a.ac_temp, stability: a.stability_score }))

  const prompt = lang === 'de'
    ? `Du bist Sebastians Schlafcoach. Analysiere diese Schlaf-HR-Daten der letzten Woche und erstelle einen wöchentlichen Bericht.`
    : `You are Sebastian's sleep coach. Analyse this week's sleep HR data and write a weekly report.`

  const dataContext = `
WEEK SUMMARY (${analyses.length} nights analysed):
- Avg stability score: ${avgStability}/10
- Avg spikes per night: ${avgSpikes}
- Avg HR baseline: ${avgBaseline}bpm
- Dominant cause pattern: ${dominantCause}
- Cause breakdown: ${JSON.stringify(causeCounts)}
- Eye bag risk flagged: ${analyses.filter(a => a.eye_bag_risk === 'high').length} nights
- Micro-arousals likely: ${analyses.filter(a => a.micro_arousals_likely).length} nights

DINNER TIMING CORRELATION:
- Late dinner (after 8pm) avg stability: ${lateDinnerAvg ? lateDinnerAvg.toFixed(1) : 'insufficient data'}
- Early dinner avg stability: ${earlyDinnerAvg ? earlyDinnerAvg.toFixed(1) : 'insufficient data'}

AC TEMPERATURE DATA:
${acCorrelation.length ? acCorrelation.map(d => `${d.temp}°C → stability ${d.stability}`).join(', ') : 'insufficient data'}

INDIVIDUAL NIGHTS:
${analyses.map(a => `${a.date}: stability ${a.stability_score}/10, ${a.spike_count} spikes, cause: ${a.likely_cause}, dinner: ${a.dinner_time || '?'}, AC: ${a.ac_temp || '?'}°C`).join('\n')}`

  const instruction = lang === 'de'
    ? `Schreibe 4-5 direkte Sätze. Was ist das dominante Muster? Was ist die wahrscheinlichste Ursache — Schilddrüse, Stress, Essen oder Temperatur? Nenne konkrete Datenpunkte. Was sollte diese Woche anders gemacht werden?`
    : `Write 4-5 direct sentences. What is the dominant pattern? What is the most likely cause — thyroid, stress, food timing, or temperature? Reference specific data points. What should change this week? Be direct and evidence-based.`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{ role: 'user', content: `${prompt}\n\n${dataContext}\n\n${instruction}` }]
    })
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── Cause badge ──────────────────────────────────────────────────────────────

const CAUSE_META = {
  thyroid:     { label: 'Thyroid',     color: 'var(--amber)',  emoji: '💊' },
  stress:      { label: 'Stress',      color: 'var(--red)',    emoji: '😰' },
  apnea:       { label: 'Apnea?',      color: 'var(--red)',    emoji: '😮‍💨' },
  temperature: { label: 'Temperature', color: 'var(--blue)',   emoji: '🌡' },
  food:        { label: 'Food timing', color: 'var(--amber)',  emoji: '🍽' },
  mixed:       { label: 'Mixed',       color: 'var(--purple)', emoji: '🔀' },
  unclear:     { label: 'Unclear',     color: 'var(--text2)',  emoji: '❓' },
}

function CauseBadge({ cause, confidence }) {
  const meta = CAUSE_META[cause] || CAUSE_META.unclear
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 12,
      background: `${meta.color}18`, border: `0.5px solid ${meta.color}50`,
      fontSize: 11, color: meta.color, fontWeight: 600,
    }}>
      {meta.emoji} {meta.label}
      {confidence && <span style={{ fontWeight: 400, opacity: 0.7 }}>· {confidence}</span>}
    </span>
  )
}

function StabilityScore({ score, size = 'md' }) {
  const color = score >= 8 ? 'var(--green)' : score >= 6 ? 'var(--amber)' : 'var(--red)'
  const bg = score >= 8 ? 'var(--green-light)' : score >= 6 ? 'rgba(186,117,23,0.1)' : 'rgba(194,48,48,0.1)'
  const dim = size === 'lg' ? 52 : 38
  return (
    <div style={{ width: dim, height: dim, borderRadius: '50%', background: bg,
      border: `2px solid ${color}`, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <div style={{ fontSize: size === 'lg' ? 20 : 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 8, color, opacity: 0.7 }}>/10</div>
    </div>
  )
}

// ─── Single night card ────────────────────────────────────────────────────────

function NightCard({ analysis, lang }) {
  const [open, setOpen] = useState(false)
  const scaleRange = analysis.axis_max - analysis.axis_min
  const isScaleNarrow = scaleRange <= 15
  const spikesClinical = analysis.spike_avg_magnitude >= 10

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>
        <StabilityScore score={analysis.stability_score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{format(new Date(analysis.date + 'T12:00:00'), 'd MMM')}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span>{analysis.spike_count} spikes</span>
            <span>·</span>
            <span>{analysis.axis_min}–{analysis.axis_max} bpm</span>
            <span>·</span>
            <span style={{ color: spikesClinical ? 'var(--red)' : isScaleNarrow ? 'var(--amber)' : 'var(--green)' }}>
              {spikesClinical ? 'clinically relevant' : isScaleNarrow ? 'scale distortion' : 'minor'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <CauseBadge cause={analysis.likely_cause} confidence={analysis.cause_confidence} />
          {analysis.eye_bag_risk === 'high' && <span style={{ fontSize: 10, color: 'var(--text3)' }}>👁 eye bag risk</span>}
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.15s', flexShrink: 0 }}>
          <path d="M2 4l4 4 4-4" stroke="var(--text3)" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </div>

      {open && (
        <div style={{ padding: '10px 14px 14px', borderTop: '0.5px solid var(--border)', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Scale context — always show this first */}
          <div style={{
            background: isScaleNarrow ? 'rgba(186,117,23,0.08)' : 'rgba(26,122,94,0.06)',
            border: `0.5px solid ${isScaleNarrow ? 'var(--amber)' : 'var(--green-border)'}`,
            borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.5
          }}>
            <strong style={{ color: isScaleNarrow ? 'var(--amber)' : 'var(--green)' }}>
              {isScaleNarrow ? '⚠ Narrow scale — visual distortion likely' : '✓ Scale context'}
            </strong>
            <br />
            {lang === 'de'
              ? `Y-Achse: ${analysis.axis_min}–${analysis.axis_max} bpm (Δ${scaleRange} bpm). Spikes von Ø${analysis.spike_avg_magnitude} bpm ${spikesClinical ? 'sind klinisch relevant (>10bpm)' : `entsprechen ${((analysis.spike_avg_magnitude / scaleRange) * 100).toFixed(0)}% der Skalenbreite — aber nur ${analysis.spike_avg_magnitude} absoluten BPM.`}`
              : `Y-axis: ${analysis.axis_min}–${analysis.axis_max} bpm (Δ${scaleRange} bpm). Avg spikes of ${analysis.spike_avg_magnitude} bpm ${spikesClinical ? 'are clinically relevant (>10bpm)' : `fill ${((analysis.spike_avg_magnitude / scaleRange) * 100).toFixed(0)}% of the chart — but are only ${analysis.spike_avg_magnitude} absolute bpm.`}`}
          </div>

          {/* Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {[
              { label: 'Baseline', value: `${analysis.hr_baseline}`, unit: 'bpm', color: 'var(--blue)' },
              { label: 'Spikes', value: `${analysis.spike_count}`, unit: `max ${analysis.spike_max_magnitude}bpm`, color: analysis.spike_count > 6 ? 'var(--red)' : 'var(--amber)' },
              { label: 'Stable', value: `${analysis.stable_pct}%`, unit: 'of night', color: analysis.stable_pct >= 70 ? 'var(--green)' : 'var(--amber)' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>{m.unit}</div>
              </div>
            ))}
          </div>

          {/* Analysis text */}
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>{analysis.analysis}</div>

          {/* Cause reasoning */}
          <div style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--surface)', borderRadius: 8, padding: '7px 10px' }}>
            <strong>{lang === 'de' ? 'Wahrscheinliche Ursache:' : 'Likely cause:'}</strong> {analysis.cause_reasoning}
          </div>

          {/* Micro arousals */}
          {analysis.micro_arousals_likely && (
            <div style={{ fontSize: 11, color: 'var(--purple)', background: 'rgba(107,63,160,0.07)', borderRadius: 8, padding: '7px 10px' }}>
              ⚡ <strong>{lang === 'de' ? 'Mikro-Arousals wahrscheinlich' : 'Micro-arousals likely'}</strong>
              {analysis.micro_arousal_count ? ` (~${analysis.micro_arousal_count} detected)` : ''}
              {' '}— {lang === 'de' ? 'erklärt Augenringe trotz ausreichender Schlafdauer' : 'explains eye bags despite adequate sleep duration'}
            </div>
          )}

          {/* Recommendation */}
          {analysis.recommendation && (
            <div style={{ fontSize: 11, color: 'var(--green)', background: 'var(--green-light)', borderRadius: 8, padding: '7px 10px', border: '0.5px solid var(--green-border)' }}>
              💡 <strong>{lang === 'de' ? 'Heute Nacht:' : 'Tonight:'}</strong> {analysis.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Weekly report card ───────────────────────────────────────────────────────

function WeeklyReport({ analyses, session, lang }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  useEffect(() => {
    // Check for saved report
    supabase.from('daily_logs').select('ai_weekly_sleep_report').eq('user_id', session.user.id).eq('date', weekStart).maybeSingle()
      .then(({ data }) => { if (data?.ai_weekly_sleep_report) { setReport(data.ai_weekly_sleep_report); setLoaded(true) } })
  }, [weekStart])

  async function generate() {
    setLoading(true)
    try {
      const text = await generateWeeklySleepReport(analyses, [], lang)
      setReport(text)
      await supabase.from('daily_logs').upsert({
        user_id: session.user.id, date: weekStart,
        ai_weekly_sleep_report: text, updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
    } catch (e) { showToast('Report failed') }
    setLoading(false)
  }

  if (analyses.length < 3) return (
    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
      {lang === 'de' ? `${3 - analyses.length} weitere Nächte für Wochenbericht` : `${3 - analyses.length} more nights needed for weekly report`}
    </div>
  )

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {report ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{report}</div>
          <button onClick={generate} disabled={loading} style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' }}>
            {loading ? '...' : (lang === 'de' ? '↺ Neu generieren' : '↺ Regenerate')}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {lang === 'de' ? `${analyses.length} Nächte analysiert. Wöchentliche Ursachen-Analyse bereit.` : `${analyses.length} nights analysed. Weekly cause analysis ready.`}
          </div>
          <button className="btn-primary" onClick={generate} disabled={loading}>
            {loading ? (lang === 'de' ? 'Analysiere...' : 'Analysing...') : (lang === 'de' ? '🔬 Wöchentliche Schlafanalyse' : '🔬 Generate weekly sleep report')}
          </button>
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SleepHRAnalysis({ session }) {
  const { lang } = useLang()
  const fileRef = useRef()
  const [analyses, setAnalyses] = useState([])
  const [loading, setLoading] = useState(true)
  const [analysing, setAnalysing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [selectedDate, setSelectedDate] = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'))
  const [eyeBags, setEyeBags] = useState(false)
  const [tab, setTab] = useState('nightly') // 'nightly' | 'weekly'

  useEffect(() => { fetchAnalyses() }, [session.user.id])

  async function fetchAnalyses() {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('sleep_hr_analysis')
      .select('*')
      .eq('user_id', session.user.id)
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: false })
    setAnalyses(data || [])
    setLoading(false)
  }

  async function handleFile(file) {
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setAnalysing(true)

    try {
      const base64 = await fileToBase64(file)
      const mimeType = file.type || 'image/jpeg'

      // Fetch context for the selected date
      const [{ data: contextLog }, { data: recent }] = await Promise.all([
        supabase.from('daily_logs').select('*').eq('user_id', session.user.id).eq('date', selectedDate).maybeSingle(),
        supabase.from('sleep_hr_analysis').select('*').eq('user_id', session.user.id).order('date', { ascending: false }).limit(7),
      ])

      const result = await analyseSleepHRScreenshot(base64, mimeType, selectedDate, contextLog, recent || [], lang)

      // Upload screenshot to storage
      const path = `${session.user.id}/sleep-hr/${selectedDate}.jpg`
      await supabase.storage.from('progress-photos').upload(path, file, { contentType: mimeType, upsert: true })

      // Save analysis
      await supabase.from('sleep_hr_analysis').upsert({
        user_id: session.user.id,
        date: selectedDate,
        screenshot_path: path,
        eye_bag_flag: eyeBags,
        dinner_time: contextLog?.dinner_time || null,
        ac_temp: contextLog?.ac_temp || null,
        ...result,
      }, { onConflict: 'user_id,date' })

      setPreview(null)
      showToast(lang === 'de' ? 'Analyse gespeichert' : 'Analysis saved')
      fetchAnalyses()
    } catch (e) {
      console.error(e)
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
      setPreview(null)
    }
    setAnalysing(false)
  }

  const weekAnalyses = analyses.filter(a => {
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    return a.date >= weekStart
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px' }}>

      {/* Upload section */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">📷 {lang === 'de' ? 'WHOOP Screenshot' : 'WHOOP Screenshot'}</span>
          {analyses.length > 0 && (
            <span className="badge" style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '0.5px solid var(--border)' }}>
              {analyses.length} {lang === 'de' ? 'Nächte' : 'nights'}
            </span>
          )}
        </div>

        <div style={{ padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Date selector */}
          <div className="field">
            <label className="field-label">{lang === 'de' ? 'Schlafnacht (Screenshot von)' : 'Sleep night (screenshot from)'}</label>
            <input className="field-input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')} />
          </div>

          {/* Eye bags toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setEyeBags(v => !v)} style={{
              width: 24, height: 24, borderRadius: 7,
              border: `1.5px solid ${eyeBags ? 'var(--purple)' : 'var(--border)'}`,
              background: eyeBags ? 'rgba(107,63,160,0.1)' : 'var(--surface2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0
            }}>
              {eyeBags && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="var(--purple)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>
              👁 {lang === 'de' ? 'Augenringe heute Morgen' : 'Eye bags this morning'}
            </span>
          </div>

          {/* Upload button */}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { handleFile(e.target.files[0]); e.target.value = '' }} />

          {analysing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'var(--green-light)', borderRadius: 10, border: '0.5px solid var(--green-border)' }}>
              <div className="spinner" style={{ width: 18, height: 18, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                  {lang === 'de' ? 'Analysiere HR-Muster...' : 'Analysing HR patterns...'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                  {lang === 'de' ? 'Liest Y-Achse · erkennt Spikes · bestimmt Ursache' : 'Reading Y-axis · detecting spikes · determining cause'}
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderRadius: 10, border: '1px dashed var(--green-border)',
              background: 'rgba(26,122,94,0.03)', cursor: 'pointer', fontFamily: 'inherit', width: '100%',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v9M6 9l3-4 3 4" stroke="var(--green)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><rect x="2" y="12" width="14" height="3" rx="1.5" stroke="var(--green)" strokeWidth="1.3"/></svg>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>
                  {lang === 'de' ? 'WHOOP HR-Screenshot hochladen' : 'Upload WHOOP HR screenshot'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                  {lang === 'de' ? 'Claude liest absolute BPM-Werte · erkennt Muster · bestimmt Ursache' : 'Claude reads absolute BPM · detects patterns · determines cause'}
                </div>
              </div>
            </button>
          )}

          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>
            {lang === 'de'
              ? 'In der WHOOP App: Schlafdetails → Herzfrequenzkurve → Screenshot machen'
              : 'In WHOOP app: Sleep details → Heart rate graph → Take screenshot'}
          </div>
        </div>
      </div>

      {/* Results tabs */}
      {analyses.length > 0 && (
        <div className="card">
          <div className="tabs-bar">
            <button className={`tab-btn ${tab === 'nightly' ? 'active' : ''}`} onClick={() => setTab('nightly')}>
              {lang === 'de' ? 'Nächte' : 'Nightly'}
            </button>
            <button className={`tab-btn ${tab === 'weekly' ? 'active' : ''}`} onClick={() => setTab('weekly')}>
              🔬 {lang === 'de' ? 'Wochenbericht' : 'Weekly'}
            </button>
          </div>

          {tab === 'nightly' && (
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)', fontSize: 13 }}>Loading...</div>
              ) : (
                analyses.map(a => <NightCard key={a.id} analysis={a} lang={lang} />)
              )}
            </div>
          )}

          {tab === 'weekly' && (
            <WeeklyReport analyses={weekAnalyses.length >= 3 ? weekAnalyses : analyses.slice(0, 7)} session={session} lang={lang} />
          )}
        </div>
      )}
    </div>
  )
}
