import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { format } from 'date-fns'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

async function estimateCaloriesFromPhoto(base64Image, mimeType) {
  const response = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Image }
          },
          {
            type: 'text',
            text: `You are a nutrition estimator. Analyse this food photo and provide a rough calorie and macro estimate. Be practical and realistic — this is for personal health tracking, not clinical use.

Respond ONLY with a valid JSON object, no markdown, no explanation, just the JSON:
{
  "meal_name": "short descriptive name of what you see",
  "calories": number (total kcal estimate),
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams),
  "confidence": "low" | "medium" | "high",
  "notes": "one short sentence about your estimate or any caveats"
}

If you cannot identify food in the image, return:
{"error": "No food detected in this image"}`
          }
        ]
      }]
    })
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text || ''
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      // Resize to max 1024px and compress to jpeg 0.85
      const MAX = 800
      let w = img.width, h = img.height
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75)
      resolve(dataUrl.split(',')[1])
    }
    img.onerror = reject
    img.src = url
  })
}

const CONFIDENCE_COLORS = {
  high: 'var(--green)',
  medium: 'var(--amber)',
  low: 'var(--red)',
}

export default function MealLogger({ session, date, onCaloriesUpdated }) {
  const { t, lang } = useLang()
  const fileRef = useRef()
  const [meals, setMeals] = useState([])
  const [analysing, setAnalysing] = useState(false)
  const [preview, setPreview] = useState(null) // { base64, mimeType, result }
  const [mealType, setMealType] = useState('lunch')
  const [editingCalories, setEditingCalories] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualCals, setManualCals] = useState('')
  const [manualProtein, setManualProtein] = useState('')
  const [manualCarbs, setManualCarbs] = useState('')
  const [manualFat, setManualFat] = useState('')
  const [error, setError] = useState(null)

  const dateStr = format(date || new Date(), 'yyyy-MM-dd')

  useEffect(() => { fetchMeals() }, [dateStr, session.user.id])

  async function fetchMeals() {
    const { data } = await supabase
      .from('meal_logs')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('date', dateStr)
      .order('logged_at', { ascending: true })
    setMeals(data || [])
    if (data) {
      const total = data.reduce((sum, m) => sum + (m.calories || 0), 0)
      onCaloriesUpdated?.(total)
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setError(null)
    setAnalysing(true)
    setPreview(null)

    try {
      const mimeType = 'image/jpeg' // always jpeg after canvas compression
      const base64 = await fileToBase64(file)
      const objectUrl = URL.createObjectURL(file)

      const result = await estimateCaloriesFromPhoto(base64, mimeType)

      if (result.error) {
        setError(result.error)
        setAnalysing(false)
        return
      }

      setPreview({ objectUrl, result, mimeType })
    } catch (err) {
      setError(lang === 'de' ? 'Analyse fehlgeschlagen. Bitte erneut versuchen.' : 'Analysis failed. Please try again.')
      console.error(err)
    }
    setAnalysing(false)
  }

  async function confirmMeal() {
    if (!preview) return
    const { result } = preview

    const calories = editingCalories !== null ? parseInt(editingCalories) : result.calories

    await supabase.from('meal_logs').insert({
      user_id: session.user.id,
      date: dateStr,
      meal_name: result.meal_name,
      meal_type: mealType,
      calories,
      protein: result.protein,
      carbs: result.carbs,
      fat: result.fat,
      source: 'ai_photo',
    })

    setPreview(null)
    setEditingCalories(null)
    URL.revokeObjectURL(preview.objectUrl)
    fetchMeals()
  }

  async function saveManual() {
    if (!manualName || !manualCals) return
    await supabase.from('meal_logs').insert({
      user_id: session.user.id,
      date: dateStr,
      meal_name: manualName,
      meal_type: mealType,
      calories: parseInt(manualCals),
      protein: manualProtein ? parseFloat(manualProtein) : null,
      carbs: manualCarbs ? parseFloat(manualCarbs) : null,
      fat: manualFat ? parseFloat(manualFat) : null,
      source: 'manual',
    })
    setShowManual(false)
    setManualName('')
    setManualCals('')
    setManualProtein('')
    setManualCarbs('')
    setManualFat('')
    fetchMeals()
  }

  async function deleteMeal(id) {
    await supabase.from('meal_logs').delete().eq('id', id)
    fetchMeals()
  }

  const totalCals = meals.reduce((sum, m) => sum + (m.calories || 0), 0)

  const mealTypeLabel = (type) => {
    const labels = {
      en: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' },
      de: { breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack' },
    }
    return labels[lang]?.[type] || type
  }

  const confidenceLabel = (c) => {
    const labels = { en: { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }, de: { high: 'Hohe Konfidenz', medium: 'Mittlere Konfidenz', low: 'Niedrige Konfidenz' } }
    return labels[lang]?.[c] || c
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Meal list */}
      {meals.length > 0 && (
        <div style={{ borderBottom: '0.5px solid var(--border)' }}>
          {meals.map(meal => (
            <div key={meal.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{meal.meal_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1, display: 'flex', gap: 6 }}>
                  <span>{mealTypeLabel(meal.meal_type)}</span>
                  {meal.protein && <span>P {Math.round(meal.protein)}g</span>}
                  {meal.carbs && <span>C {Math.round(meal.carbs)}g</span>}
                  {meal.fat && <span>F {Math.round(meal.fat)}g</span>}
                  {meal.source === 'ai_photo' && (
                    <span style={{ color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 2 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1l1 2 2.5.4-1.8 1.7.4 2.5L5 6.5l-2.1 1.1.4-2.5L1.5 3.4 4 3 5 1z" stroke="var(--green)" strokeWidth="0.8" strokeLinejoin="round"/></svg>
                      AI
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>
                {meal.calories}
              </div>
              <button onClick={() => deleteMeal(meal.id)} style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.5a1 1 0 001 .9h4.6a1 1 0 001-.9L11 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: 'var(--surface2)' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{lang === 'de' ? 'Gesamt heute' : 'Total today'}</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>{totalCals} kcal</span>
          </div>
        </div>
      )}

      {/* AI result preview */}
      {preview && (
        <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <img src={preview.objectUrl} alt="meal" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '0.5px solid var(--border)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{preview.result.meal_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3, lineHeight: 1.4 }}>{preview.result.notes}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: CONFIDENCE_COLORS[preview.result.confidence] }} />
                <span style={{ fontSize: 10, color: CONFIDENCE_COLORS[preview.result.confidence] }}>{confidenceLabel(preview.result.confidence)}</span>
              </div>
            </div>
          </div>

          {/* Macro grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[
              { label: lang === 'de' ? 'Kalorien' : 'Calories', value: editingCalories !== null ? editingCalories : preview.result.calories, unit: 'kcal', color: 'var(--amber)', editable: true },
              { label: lang === 'de' ? 'Eiweiß' : 'Protein', value: Math.round(preview.result.protein), unit: 'g', color: 'var(--blue)' },
              { label: lang === 'de' ? 'Kohlenhydrate' : 'Carbs', value: Math.round(preview.result.carbs), unit: 'g', color: 'var(--purple)' },
              { label: lang === 'de' ? 'Fett' : 'Fat', value: Math.round(preview.result.fat), unit: 'g', color: 'var(--text2)' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{m.label}</div>
                {m.editable ? (
                  <input
                    type="number"
                    value={editingCalories !== null ? editingCalories : preview.result.calories}
                    onChange={e => setEditingCalories(e.target.value)}
                    style={{ width: '100%', background: 'none', border: 'none', outline: 'none', textAlign: 'center', fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color, padding: 0 }}
                    inputMode="numeric"
                  />
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                )}
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>{m.unit}</div>
              </div>
            ))}
          </div>

          {/* Meal type selector */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lang === 'de' ? 'Mahlzeit' : 'Meal type'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {MEAL_TYPES.map(type => (
                <button key={type} onClick={() => setMealType(type)} style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: '0.5px solid var(--border)', background: mealType === type ? 'var(--green-light)' : 'var(--surface2)', color: mealType === type ? 'var(--green)' : 'var(--text2)', fontSize: 11, fontWeight: mealType === type ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {mealTypeLabel(type)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setPreview(null); setEditingCalories(null) }} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </button>
            <button onClick={confirmMeal} style={{ flex: 2, padding: '10px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {lang === 'de' ? 'Mahlzeit speichern' : 'Save meal'}
            </button>
          </div>
        </div>
      )}

      {/* Manual entry form */}
      {showManual && (
        <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{lang === 'de' ? 'Mahlzeit manuell eingeben' : 'Manual meal entry'}</div>
          <div className="field">
            <label className="field-label">{lang === 'de' ? 'Name' : 'Meal name'}</label>
            <input className="field-input" value={manualName} onChange={e => setManualName(e.target.value)} placeholder={lang === 'de' ? 'z.B. Haferflocken mit Beeren' : 'e.g. Oats with berries'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field">
              <label className="field-label">{lang === 'de' ? 'Kalorien' : 'Calories'}</label>
              <input className="field-input" type="number" value={manualCals} onChange={e => setManualCals(e.target.value)} placeholder="450" inputMode="numeric" />
            </div>
            <div className="field">
              <label className="field-label">{lang === 'de' ? 'Eiweiß (g)' : 'Protein (g)'}</label>
              <input className="field-input" type="number" value={manualProtein} onChange={e => setManualProtein(e.target.value)} placeholder="20" inputMode="decimal" />
            </div>
            <div className="field">
              <label className="field-label">{lang === 'de' ? 'Kohlenhydrate (g)' : 'Carbs (g)'}</label>
              <input className="field-input" type="number" value={manualCarbs} onChange={e => setManualCarbs(e.target.value)} placeholder="50" inputMode="decimal" />
            </div>
            <div className="field">
              <label className="field-label">{lang === 'de' ? 'Fett (g)' : 'Fat (g)'}</label>
              <input className="field-input" type="number" value={manualFat} onChange={e => setManualFat(e.target.value)} placeholder="12" inputMode="decimal" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {MEAL_TYPES.map(type => (
              <button key={type} onClick={() => setMealType(type)} style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: '0.5px solid var(--border)', background: mealType === type ? 'var(--green-light)' : 'var(--surface2)', color: mealType === type ? 'var(--green)' : 'var(--text2)', fontSize: 11, fontWeight: mealType === type ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                {mealTypeLabel(type)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowManual(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </button>
            <button onClick={saveManual} disabled={!manualName || !manualCals} style={{ flex: 2, padding: '10px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: (!manualName || !manualCals) ? 0.5 : 1 }}>
              {lang === 'de' ? 'Speichern' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ margin: '8px 14px', padding: '10px 12px', background: 'var(--red-light)', borderRadius: 8, fontSize: 12, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--red)" strokeWidth="1.1"/><path d="M7 4.5v3M7 9.5v.5" stroke="var(--red)" strokeWidth="1.2" strokeLinecap="round"/></svg>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 14 }}>×</button>
        </div>
      )}

      {/* Action buttons */}
      {!preview && !showManual && (
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

          {analysing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'var(--green-light)', borderRadius: 10, border: '0.5px solid var(--green-border)' }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid var(--green-light)', borderTopColor: 'var(--green)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{lang === 'de' ? 'Foto wird analysiert...' : 'Analysing photo...'}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{lang === 'de' ? 'Claude schätzt Kalorien und Makros' : 'Claude is estimating calories and macros'}</div>
              </div>
            </div>
          ) : (
            <>
              <button onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px dashed var(--green-border)', background: 'rgba(26,122,94,0.03)', cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="3" width="16" height="12" rx="2" stroke="var(--green)" strokeWidth="1.3"/><circle cx="9" cy="9" r="3" stroke="var(--green)" strokeWidth="1.3"/><path d="M6 3L7 1.5h4L12 3" stroke="var(--green)" strokeWidth="1.3"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{lang === 'de' ? 'Foto aufnehmen oder auswählen' : 'Camera or photo library'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{lang === 'de' ? 'KI schätzt Kalorien automatisch' : 'AI estimates calories automatically'}</div>
                </div>
              </button>

              <button onClick={() => setShowManual(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: '0.5px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text2)' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                {lang === 'de' ? 'Manuell eingeben' : 'Enter manually'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
