import { CLAUDE_MODEL, CAFFEINE_REGEX, ALCOHOL_REGEX } from '../lib/constants'
import { compressImage } from '../lib/imageUtils'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { format } from 'date-fns'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

async function estimateCaloriesFromPhoto(base64Image, mimeType, description = null) {
  const extraContext = description
    ? `\n\nThe user has provided additional context: "${description}". Use this to improve your estimate — it may correct portion sizes, cooking methods, or ingredients you couldn't see clearly.`
    : ''

  const response = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
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
            text: `You are a nutrition estimator. Analyse this food photo and provide a rough calorie and macro estimate. Be practical and realistic — this is for personal health tracking, not clinical use.${extraContext}

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



const CONFIDENCE_COLORS = {
  high: 'var(--green)',
  medium: 'var(--amber)',
  low: 'var(--red)',
}

export default function MealLogger({ session, date, onCaloriesUpdated, onDoneEating, addTriggered, onAddHandled }) {
  const { t, lang } = useLang()
  const fileRef = useRef()
  const [meals, setMeals] = useState([])
  const [analysing, setAnalysing] = useState(false)
  const [preview, setPreview] = useState(null) // { base64, mimeType, result }
  const [mealType, setMealType] = useState('lunch')
  const [editingCalories, setEditingCalories] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [describeText, setDescribeText] = useState('')
  const [describeAnalysing, setDescribeAnalysing] = useState(false)

  const [error, setError] = useState(null)
  const [consumedAt, setConsumedAt] = useState(format(new Date(), 'HH:mm'))
  const [isCaffeinated, setIsCaffeinated] = useState(false)
  const [isAlcohol, setIsAlcohol] = useState(false)
  const [showReassess, setShowReassess] = useState(false)
  const [dinnerTime, setDinnerTime] = useState('')
  const [reassessText, setReassessText] = useState('')
  const [reassessing, setReassessing] = useState(false)

  const dateStr = format(date || new Date(), 'yyyy-MM-dd')

  useEffect(() => { fetchMeals() }, [dateStr, session.user.id])

  useEffect(() => {
    supabase.from('daily_logs').select('dinner_time').eq('user_id', session.user.id).eq('date', dateStr).maybeSingle()
      .then(({ data }) => {
        if (data?.dinner_time) {
          const t = data.dinner_time.slice(0,5)
          setDinnerTime(t)
          if (dinnerRef.current) dinnerRef.current.value = t
        }
      })
  }, [dateStr])

  // Open add sheet when parent taps + Add
  useEffect(() => {
    if (addTriggered) {
      setShowAddSheet(true)
      if (onAddHandled) onAddHandled()
    }
  }, [addTriggered])

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
      const { base64, mimeType } = await compressImage(file)
      const objectUrl = URL.createObjectURL(file)

      const result = await estimateCaloriesFromPhoto(base64, mimeType)

      if (result.error) {
        setError(result.error)
        setAnalysing(false)
        return
      }

      setPreview({ objectUrl, result, mimeType, base64 })

      // Auto-detect caffeine (coffee, tea, soda, energy drinks)
      const hasCaffeine = CAFFEINE_REGEX.test(result.meal_name)
      const hasAlcohol = ALCOHOL_REGEX.test(result.meal_name)
      setIsCaffeinated(hasCaffeine)
      setIsAlcohol(hasAlcohol)
      setConsumedAt(format(new Date(), 'HH:mm'))
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
      consumed_at: consumedAt || null,
      is_caffeinated: isCaffeinated,
      is_alcohol: isAlcohol,
    })

    setPreview(null)
    setEditingCalories(null)
    setIsCaffeinated(false)
    URL.revokeObjectURL(preview.objectUrl)
    fetchMeals()
  }

  async function handleReassess() {
    if (!preview || !reassessText.trim()) return
    setReassessing(true)
    try {
      const result = await estimateCaloriesFromPhoto(preview.base64, preview.mimeType, reassessText.trim())
      if (!result.error) {
        setPreview(p => ({ ...p, result }))
        setEditingCalories(null)
        setShowReassess(false)
        setReassessText('')
        const hasCaffeine = CAFFEINE_REGEX.test(result.meal_name)
        const hasAlcohol = ALCOHOL_REGEX.test(result.meal_name)
        setIsCaffeinated(hasCaffeine)
        setIsAlcohol(hasAlcohol)
      }
    } catch (e) {
      console.error(e)
    }
    setReassessing(false)
  }

  async function handleDescribeEstimate() {
    if (!describeText.trim()) return
    setDescribeAnalysing(true)
    try {
      const res = await fetch('/.netlify/functions/claude-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 600,
          messages: [{ role: 'user', content: `You are a nutrition estimator. The user has described a meal in text — there is no photo. Estimate the calories and macros based on the description alone.

Meal description: "${describeText.trim()}"

Respond ONLY with valid JSON, no markdown:
{
  "meal_name": "short name for this meal",
  "calories": number,
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams),
  "confidence": "low" | "medium" | "high",
  "notes": "one sentence about your estimate"
}` }]
        })
      })
      const data = await res.json()
      const result = JSON.parse(data.content?.[0]?.text?.replace(/```json|```/g, '').trim() || '{}')
      if (!result.error && result.calories) {
        setPreview({ objectUrl: null, base64: null, mimeType: null, result })
        setShowManual(false)
        setDescribeText('')
        setEditingCalories(null)
        const hasCaffeine = CAFFEINE_REGEX.test(result.meal_name + ' ' + describeText)
        const hasAlcohol = ALCOHOL_REGEX.test(result.meal_name + ' ' + describeText)
        setIsCaffeinated(hasCaffeine)
        setIsAlcohol(hasAlcohol)
      }
    } catch (e) {
      console.error(e)
      showToast(lang === 'de' ? 'Schätzung fehlgeschlagen' : 'Estimation failed')
    }
    setDescribeAnalysing(false)
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
            <div key={meal.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '0.5px solid var(--border)', background: meal.is_alcohol ? 'rgba(107,63,160,0.06)' : meal.is_caffeinated ? 'rgba(186,117,23,0.06)' : 'transparent', borderLeft: meal.is_alcohol ? '3px solid var(--purple)' : meal.is_caffeinated ? '3px solid var(--amber)' : '3px solid transparent' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{meal.is_alcohol ? '🍷 ' : meal.is_caffeinated ? '☕ ' : ''}{meal.meal_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span>{mealTypeLabel(meal.meal_type)}</span>
                  {meal.protein && <span>P {Math.round(meal.protein)}g</span>}
                  {meal.carbs && <span>C {Math.round(meal.carbs)}g</span>}
                  {meal.fat && <span>F {Math.round(meal.fat)}g</span>}
                  {meal.is_caffeinated && meal.consumed_at && <span style={{ color: 'var(--amber)' }}>☕ {meal.consumed_at.slice(0,5)}</span>}
                  {meal.is_alcohol && meal.consumed_at && <span style={{ color: 'var(--purple)' }}>🍷 {meal.consumed_at.slice(0,5)}</span>}
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

            {/* Dinner time */}
      <div style={{ padding: '10px 14px 14px', borderTop: '0.5px solid var(--border)' }}>
        {dinnerTime ? (
          // SUCCESS STATE — done eating, with editable time
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--green-light)', border: '0.5px solid var(--green-border)' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>✅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
                  {lang === 'de' ? 'Fertig mit Essen' : 'Done eating for today'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--green)', opacity: 0.75 }}>
                  {lang === 'de' ? 'Letztes Essen um' : 'Last food at'}
                </div>
              </div>
              <input
                type="time"
                defaultValue={dinnerTime}
                onChange={e => {
                  const v = e.target.value
                  if (v) { setDinnerTime(v); supabase.from('daily_logs').upsert({ user_id: session.user.id, date: dateStr, dinner_time: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' }) }
                }}
                onBlur={e => {
                  const v = e.target.value
                  if (v) { setDinnerTime(v); supabase.from('daily_logs').upsert({ user_id: session.user.id, date: dateStr, dinner_time: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' }) }
                }}
                style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)', background: 'none', border: 'none', outline: 'none', width: 80, textAlign: 'right', cursor: 'pointer' }}
              />
            </div>
            <button onClick={() => {
              setDinnerTime('')
              supabase.from('daily_logs').upsert({ user_id: session.user.id, date: dateStr, dinner_time: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' })
            }} style={{ alignSelf: 'center', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, textDecoration: 'underline' }}>
              {lang === 'de' ? 'Rückgängig' : 'Not done yet — undo'}
            </button>
          </div>
        ) : (
          // DEFAULT STATE — not yet tapped
          <button onClick={() => {
            const now = format(new Date(), 'HH:mm')
            setDinnerTime(now)
            supabase.from('daily_logs').upsert({ user_id: session.user.id, date: dateStr, dinner_time: now, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' })
            if (onDoneEating) onDoneEating()
          }} style={{
            width: '100%', padding: '11px 14px', borderRadius: 10,
            background: 'var(--surface2)', border: '1px dashed var(--border)',
            color: 'var(--text2)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            🍽 {lang === 'de' ? 'Fertig mit Essen für heute' : 'Done eating for today'}
          </button>
        )}
      </div>

      {/* AI result preview */}
      {preview && (
        <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {preview.objectUrl && (
              <img src={preview.objectUrl} alt="meal" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border: '0.5px solid var(--border)' }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{preview.result.meal_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3, lineHeight: 1.4 }}>{preview.result.notes}</div>
              {/* Reassess button — only when photo was used */}
              {!showReassess && preview.base64 && (
                <button onClick={() => setShowReassess(true)} style={{ marginTop: 6, fontSize: 11, color: 'var(--amber)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textAlign: 'left' }}>
                  ✏️ {lang === 'de' ? 'Beschreibung hinzufügen für bessere Schätzung' : 'Describe this meal for a better estimate'}
                </button>
              )}
            </div>
          </div>

          {/* Reassess form */}
          {showReassess && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'rgba(186,117,23,0.07)', borderRadius: 10, border: '0.5px solid rgba(186,117,23,0.3)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
                ✏️ {lang === 'de' ? 'Beschreibe die Mahlzeit genauer' : 'Describe the meal for a better estimate'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                {lang === 'de' ? 'z.B. "2 große Portionen Pasta, ca. 150g Lachs, viel Öl beim Kochen"' : 'e.g. "2 large portions pasta, ~150g salmon, lots of oil used cooking"'}
              </div>
              <input
                className="field-input"
                value={reassessText}
                onChange={e => setReassessText(e.target.value)}
                placeholder={lang === 'de' ? 'Zutaten, Portionsgrößen, Zubereitungsart...' : 'Ingredients, portion sizes, cooking method...'}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setShowReassess(false); setReassessText('') }} className="btn-secondary" style={{ flex: 1 }}>
                  {lang === 'de' ? 'Abbrechen' : 'Cancel'}
                </button>
                <button onClick={handleReassess} disabled={!reassessText.trim() || reassessing} className="btn-primary" style={{ flex: 2 }}>
                  {reassessing ? (lang === 'de' ? 'Analysiere...' : 'Re-analysing...') : (lang === 'de' ? '↺ Neu schätzen' : '↺ Re-estimate')}
                </button>
              </div>
            </div>
          )}

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

          {/* Caffeine detection — show time picker if coffee detected */}
          {isCaffeinated && (
            <div style={{ background: 'rgba(186,117,23,0.08)', border: '0.5px solid rgba(186,117,23,0.3)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15 }}>☕</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>
                  {lang === 'de' ? 'Koffein erkannt — wann hast du das getrunken?' : 'Caffeine detected — what time did you have this?'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="field-input" type="time" value={consumedAt} onChange={e => setConsumedAt(e.target.value)} style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--text2)', flex: 2, lineHeight: 1.4 }}>
                  {consumedAt && (() => {
                    const [h, m] = consumedAt.split(':').map(Number)
                    const halfLifeH = h + 5
                    const displayH = halfLifeH >= 24 ? halfLifeH - 24 : halfLifeH
                    return lang === 'de'
                      ? `Halbwertszeit ~${displayH}:${String(m).padStart(2,'0')} Uhr — kann Schlaf beeinflussen`
                      : `Half-life ~${displayH}:${String(m).padStart(2,'0')} — may affect sleep`
                  })()}
                </span>
              </div>
              <button onClick={() => setIsCaffeinated(false)} style={{ alignSelf: 'flex-start', fontSize: 10, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                {lang === 'de' ? 'Kein Koffein' : 'Not caffeinated'}
              </button>
            </div>
          )}

          {isAlcohol && (
            <div style={{ background: 'rgba(107,63,160,0.07)', border: '0.5px solid rgba(107,63,160,0.25)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15 }}>🍷</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--purple)' }}>
                  {lang === 'de' ? 'Alkohol erkannt — wann hast du das getrunken?' : 'Alcohol detected — what time did you have this?'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="field-input" type="time" value={consumedAt} onChange={e => setConsumedAt(e.target.value)} style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--text2)', flex: 2, lineHeight: 1.4 }}>
                  {lang === 'de'
                    ? 'Zeitstempel wird für Schlafanalyse verwendet'
                    : 'Timestamp used for sleep impact analysis'}
                </span>
              </div>
              <button onClick={() => setIsAlcohol(false)} style={{ alignSelf: 'flex-start', fontSize: 10, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                {lang === 'de' ? 'Kein Alkohol' : 'Not alcohol'}
              </button>
            </div>
          )}

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
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {lang === 'de' ? '✍️ Mahlzeit beschreiben' : '✍️ Describe your meal'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
            {lang === 'de'
              ? 'Beschreibe was du gegessen hast — Claude schätzt Kalorien und Makros automatisch.'
              : 'Describe what you had — Claude estimates the calories and macros for you.'}
          </div>
          <textarea
            className="field-input"
            value={describeText}
            onChange={e => setDescribeText(e.target.value)}
            placeholder={lang === 'de'
              ? 'z.B. 2 Spiegeleier, 2 Scheiben Vollkorntoast mit Butter, kleiner Orangensaft'
              : 'e.g. 2 fried eggs, 2 slices wholegrain toast with butter, small orange juice'}
            rows={3}
            style={{ resize: 'none', fontSize: 13 }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {MEAL_TYPES.map(type => (
              <button key={type} onClick={() => setMealType(type)} style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: '0.5px solid var(--border)', background: mealType === type ? 'var(--green-light)' : 'var(--surface2)', color: mealType === type ? 'var(--green)' : 'var(--text2)', fontSize: 11, fontWeight: mealType === type ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                {mealTypeLabel(type)}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowManual(false); setDescribeText('') }} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--surface2)', border: '0.5px solid var(--border)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </button>
            <button onClick={handleDescribeEstimate} disabled={!describeText.trim() || describeAnalysing} style={{ flex: 2, padding: '10px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: !describeText.trim() ? 0.5 : 1 }}>
              {describeAnalysing ? (lang === 'de' ? 'Schätze...' : 'Estimating...') : (lang === 'de' ? '✨ Kalorien schätzen' : '✨ Estimate calories')}
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

      {/* Add sheet — triggered by + Add in card header */}
      {!preview && !showManual && (
        <div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

          {analysing && (
            <div style={{ margin: '0 14px 12px', display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'var(--green-light)', borderRadius: 10, border: '0.5px solid var(--green-border)' }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid var(--green-light)', borderTopColor: 'var(--green)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{lang === 'de' ? 'Foto wird analysiert...' : 'Analysing photo...'}</div>
            </div>
          )}

          {showAddSheet && !analysing && (
            <div style={{ margin: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 6, padding: '12px', background: 'var(--surface2)', borderRadius: 12, border: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                {lang === 'de' ? 'Mahlzeit hinzufügen' : 'Add a meal'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { fileRef.current?.click(); setShowAddSheet(false) }} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 10, border: '1px solid var(--green-border)', background: 'var(--green-light)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="1" y="4" width="20" height="15" rx="3" stroke="var(--green)" strokeWidth="1.5"/><circle cx="11" cy="11.5" r="4" stroke="var(--green)" strokeWidth="1.5"/><path d="M7.5 4L8.5 2h5l1 2" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>{lang === 'de' ? 'Foto' : 'Photo'}</span>
                </button>
                <button onClick={() => { setShowManual(true); setShowAddSheet(false) }} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 10, border: '0.5px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 6h14M4 11h10M4 16h7" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{lang === 'de' ? 'Beschreiben' : 'Describe'}</span>
                </button>
              </div>
              <button onClick={() => setShowAddSheet(false)} style={{ alignSelf: 'center', background: 'none', border: 'none', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}>
                {lang === 'de' ? 'Abbrechen' : 'Cancel'}
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
