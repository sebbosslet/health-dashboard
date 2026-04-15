import { useState, useEffect, useRef } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from './Toast'

// ─── Claude vision analysis ───────────────────────────────────────────────────

async function analyseSleepHR(base64, mimeType, dateStr, contextLog, recentAnalyses, eyeBags, lang) {
  const historyContext = recentAnalyses.length >= 2
    ? `\nYOUR RECENT NIGHTS:\n` + recentAnalyses.slice(0, 7).map(a =>
        `  ${a.date}: baseline ${a.hr_baseline}bpm, ${a.spike_count} spikes avg ${a.spike_avg_magnitude}bpm, stability ${a.stability_score}/10, Y-axis was ${a.axis_min}–${a.axis_max}bpm, eye bags: ${a.eye_bag_flag ? 'yes' : 'no'}`
      ).join('\n')
    : '  Not enough history yet for comparison.'

  const dayContext = contextLog ? [
    contextLog.activity?.length && `Activities: ${contextLog.activity.join(', ')}`,
    contextLog.habits?.length && `Evening habits: ${contextLog.habits.join(', ')}`,
    contextLog.calories && `Calories: ${contextLog.calories}kcal`,
    contextLog.phone_away_time && `Phone away: ${contextLog.phone_away_time.slice(0,5)}`,
    contextLog.bed_time && `Bed: ${contextLog.bed_time.slice(0,5)}`,
    contextLog.wind_down && `Wind-down: ${contextLog.wind_down}`,
    contextLog.evening_note && `Note: ${contextLog.evening_note}`,
  ].filter(Boolean).join(', ') : 'No day context logged'

  const eyeBagNote = eyeBags ? 'USER REPORTS EYE BAGS THIS MORNING — correlate sleep quality with this.' : ''

  const prompt = lang === 'de' ? `Du bist Schlafmedizin-Experte. Analysiere diesen WHOOP HR-Screenshot.

KRITISCH: Lies zuerst die Y-Achsen-Labels für absolute BPM-Werte. Alles relativ zur tatsächlichen Skala bewerten.
Tageskontext: ${dayContext}
${eyeBagNote}
${historyContext}

Antworte NUR mit JSON:
{
  "axis_min": Zahl,
  "axis_max": Zahl,
  "hr_baseline": Zahl,
  "hr_min": Zahl,
  "hr_max": Zahl,
  "hr_range": Zahl,
  "spike_count": Zahl (>8bpm über baseline),
  "spike_avg_magnitude": Zahl,
  "spike_max_magnitude": Zahl,
  "stable_pct": Zahl,
  "fragmented_pct": Zahl,
  "stability_score": Zahl 1-10,
  "analysis": "3-4 direkte Sätze. Absolut betrachtet: sind die Spikes real (>10bpm) oder nur visuell durch enge Skala? Mikro-Arousals vorhanden? Verbindung zum Tageskontext. Bezug zu Augenringen falls gemeldet.",
  "micro_arousal_assessment": "konkrete Einschätzung",
  "scale_context": "War die Skala eng oder weit? Hat das die visuelle Darstellung verzerrt?"
}`
    : `You are a sleep medicine expert. Analyse this WHOOP heart rate screenshot from sleep.

CRITICAL: Read the Y-axis labels first to get absolute BPM values. Judge everything relative to actual scale.
Day context: ${dayContext}
${eyeBagNote}
${historyContext}

Respond ONLY with JSON, no markdown:
{
  "axis_min": number,
  "axis_max": number,
  "hr_baseline": number,
  "hr_min": number,
  "hr_max": number,
  "hr_range": number,
  "spike_count": number (rises >8bpm above baseline),
  "spike_avg_magnitude": number,
  "spike_max_magnitude": number,
  "stable_pct": number,
  "fragmented_pct": number,
  "stability_score": number 1-10,
  "analysis": "3-4 direct sentences. In absolute terms: are the spikes real (>10bpm) or visually exaggerated by tight scale? Micro-arousals present? Connection to day context. Reference eye bags if reported.",
  "micro_arousal_assessment": "concrete assessment",
  "scale_context": "Was the scale tight or wide? Did it distort visual appearance?"
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
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
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ─── Stability score circle ───────────────────────────────────────────────────

function ScoreCircle({ score, size = 48 }) {
  const color = score >= 8 ? 'var(--green)' : score >= 6 ? 'var(--amber)' : 'var(--red)'
  const bg = score >= 8 ? 'var(--green-light)' : score >= 6 ? 'rgba(186,117,23,0.1)' : 'rgba(194,48,48,0.1)'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, border: `2px solid ${color}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <div style={{ fontSize: size * 0.38, fontWeight: 700, fontFamily: 'var(--font-mono)', color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: size * 0.17, color, opacity: 0.7 }}>/10</div>
    </div>
  )
}

// ─── Single night card ────────────────────────────────────────────────────────

function NightCard({ a, lang }) {
  const [open, setOpen] = useState(false)
  const isVisualExaggeration = a.hr_range <= 12 && a.spike_count > 3

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}>
        <ScoreCircle score={a.stability_score} size={42} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{format(new Date(a.date + 'T12:00:00'), 'd MMM yyyy')}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{a.axis_min}–{a.axis_max} bpm</span>
            <span>⚡ {a.spike_count}× {lang === 'de' ? 'Spikes' : 'spikes'}</span>
            <span style={{ color: a.hr_range <= 12 ? 'var(--green)' : a.hr_range <= 20 ? 'var(--amber)' : 'var(--red)' }}>
              Δ{a.hr_range} bpm
            </span>
            {isVisualExaggeration && (
              <span style={{ color: 'var(--blue)', fontSize: 10 }}>
                {lang === 'de' ? '⚠ enge Skala' : '⚠ tight scale'}
              </span>
            )}
            {a.eye_bag_flag && <span>👁</span>}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s', flexShrink: 0 }}>
          <path d="M3 5l4 4 4-4" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {open && (
        <div style={{ padding: '10px 14px 14px', background: 'var(--surface2)', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Scale context — always show first */}
          <div style={{ fontSize: 11, padding: '7px 10px', borderRadius: 8, background: 'var(--surface)', border: '0.5px solid var(--border)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>📏 {lang === 'de' ? 'Skala' : 'Scale context'}:</span>{' '}
            <span style={{ color: 'var(--text2)' }}>{a.scale_context || `Y-axis ${a.axis_min}–${a.axis_max} bpm. ${isVisualExaggeration ? (lang === 'de' ? 'Enge Skala — Spikes sehen visuell größer aus als sie sind.' : 'Tight scale — spikes look bigger visually than they are.') : ''}`}</span>
          </div>

          {/* Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {[
              { label: lang === 'de' ? 'Baseline' : 'Baseline', value: `${a.hr_baseline}`, unit: 'bpm', color: 'var(--blue)' },
              { label: lang === 'de' ? 'Größter Spike' : 'Biggest spike', value: `+${a.spike_max_magnitude}`, unit: 'bpm', color: a.spike_max_magnitude >= 10 ? 'var(--red)' : 'var(--amber)' },
              { label: lang === 'de' ? 'Stabil' : 'Stable', value: `${a.stable_pct}`, unit: '%', color: a.stable_pct >= 70 ? 'var(--green)' : 'var(--amber)' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color, lineHeight: 1.1 }}>{m.value}</div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>{m.unit}</div>
              </div>
            ))}
          </div>

          {/* Analysis */}
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>{a.analysis}</div>

          {/* Micro-arousals */}
          {a.micro_arousal_assessment && (
            <div style={{ fontSize: 11, color: 'var(--purple)', background: 'rgba(107,63,160,0.07)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              <strong>{lang === 'de' ? 'Mikro-Arousals:' : 'Micro-arousals:'}</strong> {a.micro_arousal_assessment}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Trend summary (if ≥3 nights) ────────────────────────────────────────────

function TrendSummary({ analyses, lang }) {
  if (analyses.length < 3) return null
  const avgStability = +(analyses.reduce((a, n) => a + n.stability_score, 0) / analyses.length).toFixed(1)
  const avgSpikes = +(analyses.reduce((a, n) => a + n.spike_count, 0) / analyses.length).toFixed(1)
  const eyeBagNights = analyses.filter(n => n.eye_bag_flag).length
  const eyeBagWithPoorSleep = analyses.filter(n => n.eye_bag_flag && n.stability_score < 6).length
  const recent3Avg = +(analyses.slice(0, 3).reduce((a, n) => a + n.stability_score, 0) / Math.min(3, analyses.length)).toFixed(1)
  const prior3Avg = analyses.length >= 6 ? +(analyses.slice(3, 6).reduce((a, n) => a + n.stability_score, 0) / 3).toFixed(1) : null
  const trend = prior3Avg ? +(recent3Avg - prior3Avg).toFixed(1) : null

  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text2)', marginBottom: 2 }}>
        {lang === 'de' ? `Trend · ${analyses.length} Nächte` : `Trend · ${analyses.length} nights`}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 3 }}>{lang === 'de' ? 'Ø Stabilität' : 'Avg stability'}</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: avgStability >= 7 ? 'var(--green)' : 'var(--amber)' }}>{avgStability}</div>
          {trend !== null && (
            <div style={{ fontSize: 10, color: trend >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)} {lang === 'de' ? 'letzte 3 Nächte' : 'last 3 nights'}
            </div>
          )}
        </div>
        <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 3 }}>{lang === 'de' ? 'Ø Spikes' : 'Avg spikes'}</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: avgSpikes <= 3 ? 'var(--green)' : avgSpikes <= 6 ? 'var(--amber)' : 'var(--red)' }}>{avgSpikes}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{lang === 'de' ? 'pro Nacht' : 'per night'}</div>
        </div>
        {eyeBagNights > 0 && (
          <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 3 }}>👁 {lang === 'de' ? 'Augenringe' : 'Eye bags'}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--purple)' }}>{eyeBagNights}</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
              {eyeBagWithPoorSleep}/{eyeBagNights} {lang === 'de' ? 'mit schlechtem Schlaf' : 'with poor sleep'}
            </div>
          </div>
        )}
      </div>
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
  const [showUpload, setShowUpload] = useState(false)
  const [eyeBags, setEyeBags] = useState(false)
  const [selectedDate, setSelectedDate] = useState(format(subDays(new Date(), 0), 'yyyy-MM-dd'))

  useEffect(() => { fetchAnalyses() }, [session.user.id])

  async function fetchAnalyses() {
    const { data } = await supabase
      .from('sleep_hr_analysis')
      .select('*')
      .eq('user_id', session.user.id)
      .order('date', { ascending: false })
      .limit(30)
    setAnalyses(data || [])
    setLoading(false)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setAnalysing(true)
    setShowUpload(false)

    try {
      const base64 = await fileToBase64(file)
      const mimeType = file.type || 'image/jpeg'

      // Fetch context for the selected date
      const { data: contextLog } = await supabase
        .from('daily_logs').select('*').eq('user_id', session.user.id).eq('date', selectedDate).maybeSingle()

      // Fetch recent analyses for comparison
      const { data: recent } = await supabase
        .from('sleep_hr_analysis').select('*').eq('user_id', session.user.id)
        .order('date', { ascending: false }).limit(7)

      // Analyse — base64 image is used here and then discarded (never stored)
      const result = await analyseSleepHR(base64, mimeType, selectedDate, contextLog, recent || [], eyeBags, lang)

      // Store ONLY the extracted metrics — not the image
      await supabase.from('sleep_hr_analysis').upsert({
        user_id: session.user.id,
        date: selectedDate,
        hr_baseline: result.hr_baseline,
        hr_min: result.hr_min,
        hr_max: result.hr_max,
        hr_range: result.hr_range,
        axis_min: result.axis_min,
        axis_max: result.axis_max,
        spike_count: result.spike_count,
        spike_avg_magnitude: result.spike_avg_magnitude,
        spike_max_magnitude: result.spike_max_magnitude,
        stable_pct: result.stable_pct,
        fragmented_pct: result.fragmented_pct,
        stability_score: result.stability_score,
        eye_bag_flag: eyeBags,
        analysis: result.analysis,
        micro_arousal_assessment: result.micro_arousal_assessment,
        scale_context: result.scale_context,
        screenshot_path: null, // intentionally null — image not stored
      }, { onConflict: 'user_id,date' })

      // Also update morning eye bag flag on daily_logs
      if (eyeBags) {
        await supabase.from('daily_logs').upsert({
          user_id: session.user.id, date: selectedDate, eye_bags: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,date' })
      }

      showToast(lang === 'de' ? 'Analyse gespeichert · Screenshot verworfen' : 'Analysis saved · screenshot discarded')
      fetchAnalyses()
    } catch (err) {
      console.error(err)
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setAnalysing(false)
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const alreadyAnalysed = analyses.some(a => a.date === selectedDate)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header card */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">💓 {lang === 'de' ? 'Schlaf-HR Analyse' : 'Sleep HR Analysis'}</span>
          {analyses.length > 0 && (
            <span className="badge" style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '0.5px solid var(--border)' }}>
              {analyses.length} {lang === 'de' ? 'Nächte' : 'nights'}
            </span>
          )}
        </div>

        {/* Trend summary */}
        {analyses.length >= 3 && (
          <div style={{ padding: '0 14px 12px' }}>
            <TrendSummary analyses={analyses} lang={lang} />
          </div>
        )}

        {/* Upload area */}
        {showUpload ? (
          <div style={{ padding: '12px 14px', borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label className="field-label">{lang === 'de' ? 'Nacht von' : 'Night of'}</label>
                <input className="field-input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} max={todayStr} />
              </div>
              <div className="field">
                <label className="field-label">👁 {lang === 'de' ? 'Augenringe heute?' : 'Eye bags today?'}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[true, false].map(v => (
                    <button key={String(v)} onClick={() => setEyeBags(v)} style={{
                      flex: 1, padding: '9px', borderRadius: 8, fontSize: 12,
                      border: `1.5px solid ${eyeBags === v ? 'var(--green)' : 'var(--border)'}`,
                      background: eyeBags === v ? 'var(--green-light)' : 'var(--surface2)',
                      color: eyeBags === v ? 'var(--green)' : 'var(--text2)',
                      fontWeight: eyeBags === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit'
                    }}>{v ? (lang === 'de' ? 'Ja' : 'Yes') : (lang === 'de' ? 'Nein' : 'No')}</button>
                  ))}
                </div>
              </div>
            </div>

            {alreadyAnalysed && (
              <div style={{ fontSize: 11, color: 'var(--amber)', background: 'rgba(186,117,23,0.08)', borderRadius: 8, padding: '7px 10px' }}>
                {lang === 'de' ? 'Diese Nacht wurde bereits analysiert. Upload überschreibt.' : 'This night already analysed. Upload will overwrite.'}
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
              {lang === 'de'
                ? '📱 Screenshot deiner WHOOP Schlaf-HR Ansicht. Das Bild wird nach der Analyse sofort verworfen — nur Messwerte werden gespeichert.'
                : '📱 Screenshot of your WHOOP sleep HR view. The image is discarded immediately after analysis — only the metrics are saved.'}
            </div>

            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowUpload(false)} className="btn-secondary">
                {lang === 'de' ? 'Abbrechen' : 'Cancel'}
              </button>
              <button onClick={() => fileRef.current?.click()} className="btn-primary" style={{ flex: 1 }}>
                📸 {lang === 'de' ? 'Screenshot auswählen' : 'Choose screenshot'}
              </button>
            </div>
          </div>
        ) : analysing ? (
          <div style={{ padding: '16px 14px', display: 'flex', alignItems: 'center', gap: 12, borderTop: '0.5px solid var(--border)' }}>
            <div className="spinner" style={{ width: 20, height: 20, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                {lang === 'de' ? 'Analysiere Screenshot...' : 'Analysing screenshot...'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                {lang === 'de' ? 'Claude liest Y-Achse und berechnet absolute BPM-Werte' : 'Claude reading Y-axis and calculating absolute BPM values'}
              </div>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowUpload(true)} style={{
            width: '100%', padding: '11px 14px', background: 'none',
            borderTop: analyses.length > 0 ? '0.5px solid var(--border)' : 'none',
            border: 'none', color: 'var(--green)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3M2 10v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="var(--green)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {lang === 'de' ? 'WHOOP Screenshot hochladen' : 'Upload WHOOP screenshot'}
          </button>
        )}
      </div>

      {/* Night cards */}
      {!loading && analyses.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {analyses.map(a => <NightCard key={a.id} a={a} lang={lang} />)}
        </div>
      )}

      {!loading && analyses.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text2)', fontSize: 13 }}>
          {lang === 'de'
            ? 'Noch keine Nächte analysiert. Mache in WHOOP einen Screenshot der Schlaf-HR und lade ihn hoch.'
            : 'No nights analysed yet. Take a screenshot of the sleep HR view in WHOOP and upload it.'}
        </div>
      )}
    </div>
  )
}
