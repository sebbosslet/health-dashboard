import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { compressImage } from '../lib/imageUtils'
import { showToast } from './Toast'
import { useLang } from '../lib/LangContext'
import { CLAUDE_MODEL } from '../lib/constants'

const FLAG_LABELS = {
  blood: 'Blood present',
  mucus: 'Mucus present',
  undigested_food: 'Undigested food',
  urgency: 'Urgency',
  pain: 'Pain',
  straining: 'Straining',
  incomplete: 'Incomplete evacuation',
  floating: 'Floating stool',
  oily: 'Oily/greasy',
}

const fmtFlags = flags => flags.map(f => FLAG_LABELS[f] || f.replace(/_/g, ' ')).join(' · ')


const BRISTOL_TYPES = [
  { type: 1, emoji: '🪨', label: 'Separate hard lumps', color: '#8B4513', signal: 'severe constipation' },
  { type: 2, emoji: '🌰', label: 'Lumpy sausage', color: '#A0522D', signal: 'mild constipation' },
  { type: 3, emoji: '🌭', label: 'Cracked sausage', color: '#8B6914', signal: 'normal' },
  { type: 4, emoji: '🍌', label: 'Smooth soft sausage', color: '#8B6914', signal: 'ideal' },
  { type: 5, emoji: '🫘', label: 'Soft blobs', color: '#A0522D', signal: 'lacking fibre' },
  { type: 6, emoji: '💧', label: 'Fluffy ragged', color: '#CD853F', signal: 'mild diarrhea' },
  { type: 7, emoji: '💦', label: 'Entirely liquid', color: '#DEB887', signal: 'diarrhea' },
]

async function analysePoopPhoto(base64, mimeType) {
  const prompt = `You are a gastroenterologist. Analyse this toilet bowl photo. The bowl may contain stool and urine together.

Only report what you can clearly see. Do not diagnose.

For bristol_suggestion: based ONLY on visible stool texture and surface — NOT water colour or shape assumptions. If you cannot clearly see the stool texture, return null.
Bristol scale reminder: 1=separate hard lumps, 2=lumpy sausage, 3=sausage with cracks, 4=smooth sausage/snake, 5=soft blobs, 6=fluffy ragged, 7=watery.

Respond ONLY with valid JSON:
{
  "color": "brown|yellow|green|black|red|pale|other",
  "assessment": "one sentence describing only the stool's visible colour and texture",
  "urine_color": "clear|pale_yellow|yellow|dark_yellow|orange|not_visible",
  "bristol_suggestion": 1-7 or null,
  "flags": ["blood", "mucus", "undigested_food"] or [],
  "confidence": "high|medium|low"
}`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
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
  const text = data.content?.[0]?.text || '{}'
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()) }
  catch { return null }
}

export default function PoopTracker({ session, date }) {
  const { lang } = useLang()
  const [logs, setLogs] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [selectedType, setSelectedType] = useState(null)
  const [note, setNote] = useState('')
  const [time, setTime] = useState(format(new Date(), 'HH:mm'))
  const [analysing, setAnalysing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  const dateStr = format(date || new Date(), 'yyyy-MM-dd')

  useEffect(() => { fetchLogs() }, [dateStr])

  async function fetchLogs() {
    const { data } = await supabase.from('poop_logs')
      .select('*').eq('user_id', session.user.id).eq('date', dateStr)
      .order('logged_at', { ascending: false })
    setLogs(data || [])
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAnalysing(true)
    try {
      const { base64, mimeType } = await compressImage(file)
      const result = await analysePoopPhoto(base64, mimeType)
      if (result) {
        setAnalysis(result)
        showToast(lang === 'de' ? 'Analyse abgeschlossen' : 'Analysis complete')
      }
    } catch (e) {
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setAnalysing(false)
  }

  async function handleSave() {
    if (!selectedType) return
    setSaving(true)
    const { error } = await supabase.from('poop_logs').insert({
      user_id: session.user.id,
      date: dateStr,
      bristol_type: selectedType,
      logged_at: time,
      note: note.trim() || null,
      color: analysis?.color || null,
      assessment: analysis?.assessment || null,
      flags: analysis?.flags?.length ? analysis.flags : null,
      ai_analysed: !!analysis,
    })
    if (!error) {
      showToast(lang === 'de' ? 'Gespeichert ✓' : 'Logged ✓')
      setShowLog(false)
      setSelectedType(null)
      setNote('')
      setAnalysis(null)
      setTime(format(new Date(), 'HH:mm'))
      fetchLogs()
    }
    setSaving(false)
  }

  async function deleteLog(id) {
    await supabase.from('poop_logs').delete().eq('id', id)
    fetchLogs()
  }

  const bristol = selectedType ? BRISTOL_TYPES.find(b => b.type === selectedType) : null

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">💩 {lang === 'de' ? 'Verdauung' : 'Bowel log'}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {logs.length} {lang === 'de' ? 'heute' : 'today'}
        </span>
      </div>

      {/* Logged entries */}
      {logs.map(log => {
        const b = BRISTOL_TYPES.find(b => b.type === log.bristol_type)
        return (
          <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '0.5px solid var(--border)' }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{b?.emoji || '💩'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                Type {log.bristol_type} · <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{b?.label}</span>
              </div>
              {log.assessment && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>{log.assessment}</div>}
              {log.flags?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 1 }}>⚠️ {fmtFlags(log.flags)}</div>
              )}
            </div>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)', flexShrink: 0 }}>{log.logged_at?.slice(0,5)}</span>
            <button onClick={() => deleteLog(log.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 15, padding: '0 2px', flexShrink: 0 }}>×</button>
          </div>
        )
      })}

      {/* Add log form */}
      {showLog ? (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Bristol scale */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {lang === 'de' ? 'Bristol-Stuhltyp' : 'Bristol stool type'}
            </div>
            {analysis?.bristol_suggestion && !selectedType && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'rgba(52,199,89,0.08)', borderRadius: 8, border: '1px solid var(--green-border)', marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>✨</span>
                <span style={{ fontSize: 12, color: 'var(--green)', flex: 1 }}>
                  Photo suggests <strong>Type {analysis.bristol_suggestion}</strong> — tap to confirm
                </span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {BRISTOL_TYPES.map(b => {
                const isSuggested = analysis?.bristol_suggestion === b.type && !selectedType
                const isSelected = selectedType === b.type
                return (
                <button key={b.type} onClick={() => setSelectedType(b.type)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 8,
                  border: `1.5px solid ${isSelected ? 'var(--green)' : isSuggested ? 'var(--green)' : 'var(--border)'}`,
                  background: isSelected ? 'var(--green-light)' : isSuggested ? 'rgba(52,199,89,0.06)' : 'var(--surface2)',
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{b.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isSelected || isSuggested ? 'var(--green)' : 'var(--text)' }}>
                      Type {b.type}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 6 }}>{b.label}</span>
                  </div>
                  <span style={{ fontSize: 10, flexShrink: 0, color: isSelected ? 'var(--green)' : isSuggested ? 'var(--green)' : 'var(--text3)' }}>
                    {isSuggested ? '✨ suggested' : b.signal}
                  </span>
                </button>
                )
              })}
            </div>
          </div>

          {/* AI analysis result */}
          {analysis && (
            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ✨ {lang === 'de' ? 'Foto-Analyse (Farbe & Flags)' : 'Photo analysis — colour & flags'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{analysis.assessment}</div>
              {analysis.color && <div style={{ fontSize: 11, color: 'var(--text2)' }}>Stool colour: {analysis.color}</div>}
              {analysis.urine_color && analysis.urine_color !== 'not_visible' && (
                <div style={{ fontSize: 11, color: analysis.urine_color === 'orange' || analysis.urine_color === 'brown' ? 'var(--amber)' : 'var(--text2)' }}>
                  Urine: {analysis.urine_color.replace(/_/g, ' ')}
                  {(analysis.urine_color === 'dark_yellow' || analysis.urine_color === 'orange') && ' — consider hydrating more'}
                </div>
              )}
              {analysis.flags?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>⚠️ {fmtFlags(analysis.flags)}</div>
              )}
            </div>
          )}

          {/* Time + photo row */}
          <div style={{ display: 'flex', gap: '25%' }}>
            <div style={{ width: '50%', flexShrink: 0 }}>
              <label className="field-label">⏰ Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: '8px 6px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="field-label">📷 {lang === 'de' ? 'Foto' : 'Photo'}</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
              <button onClick={() => fileRef.current?.click()} disabled={analysing} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '100%', height: 40, borderRadius: 8, boxSizing: 'border-box',
                border: analysis ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
                background: analysis ? 'var(--green-light)' : 'var(--surface2)',
                cursor: analysing ? 'default' : 'pointer', padding: 0,
              }}>
                {analysing
                  ? <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--green)', animation: 'spin 0.8s linear infinite' }} />
                  : <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
                      <rect x="1" y="4" width="20" height="15" rx="3" stroke={analysis ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
                      <circle cx="11" cy="11.5" r="4" stroke={analysis ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
                      <path d="M7.5 4L8.5 2h5l1 2" stroke={analysis ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                }
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowLog(false); setSelectedType(null); setAnalysis(null) }} className="btn-secondary" style={{ flex: 1 }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </button>
            <button onClick={handleSave} disabled={!selectedType || saving} className="btn-primary" style={{ flex: 2 }}>
              {saving ? (lang === 'de' ? 'Speichern...' : 'Saving...') : (lang === 'de' ? '+ Eintragen' : '+ Log it')}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowLog(true)} style={{
          width: '100%', padding: '11px 14px', background: 'none', border: 'none',
          borderTop: logs.length > 0 ? '0.5px solid var(--border)' : 'none',
          color: 'var(--green)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          {lang === 'de' ? 'Stuhlgang eintragen' : 'Log bowel movement'}
        </button>
      )}
    </div>
  )
}
