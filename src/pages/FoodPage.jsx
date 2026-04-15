import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../lib/LangContext'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'
import { format } from 'date-fns'

// ─── AI Recipe Generation ────────────────────────────────────────────────────

async function generateRecipeFromPrompt(prompt, lang) {
  const systemPrompt = lang === 'de'
    ? 'Du bist ein Ernährungsexperte und Koch. Erstelle ein detailliertes Rezept basierend auf der Anfrage. Antworte NUR mit einem gültigen JSON-Objekt, kein Markdown, keine Erklärungen.'
    : 'You are a nutritionist and chef. Create a detailed recipe based on the request. Respond ONLY with a valid JSON object, no markdown, no explanations.'

  const userPrompt = lang === 'de'
    ? `Erstelle ein Rezept für: ${prompt}\n\nJSON-Format:\n{"name":"Rezeptname","description":"Kurze Beschreibung","servings":1,"prep_time":15,"calories":500,"protein":30,"carbs":50,"fat":15,"ingredients":["200g Hähnchenbrust","100g Reis"],"instructions":"Schritt für Schritt Anleitung als einzelner Text"}`
    : `Create a recipe for: ${prompt}\n\nJSON format:\n{"name":"Recipe name","description":"Short description","servings":1,"prep_time":15,"calories":500,"protein":30,"carbs":50,"fat":15,"ingredients":["200g chicken breast","100g rice"],"instructions":"Step by step instructions as single text"}`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
      ]
    })
  })
  const data = await res.json()
  const text = data.content?.[0]?.text || ''
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

async function analyseMealPrepIngredients(description, lang) {
  const prompt = lang === 'de'
    ? `Analysiere diese Zutaten für eine Mahlzeitvorbereitung und schätze die Gesamtkalorien und Makros. Antworte NUR mit JSON:\n{"total_calories":2000,"total_protein":120,"total_carbs":200,"total_fat":60,"notes":"Kurze Anmerkung"}\n\nZutaten/Beschreibung: ${description}`
    : `Analyse these meal prep ingredients and estimate total calories and macros. Respond ONLY with JSON:\n{"total_calories":2000,"total_protein":120,"total_carbs":200,"total_fat":60,"notes":"Brief note"}\n\nIngredients/description: ${description}`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  })
  const data = await res.json()
  const text = data.content?.[0]?.text || ''
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

async function analysePortionPhoto(base64Image, mimeType, totalCalories, portionNumber, totalPortions, lang) {
  const prompt = lang === 'de'
    ? `Dies ist Portion ${portionNumber} von insgesamt ${totalPortions} Portionen einer Mahlzeitvorbereitung mit ${totalCalories} Gesamtkalorien. Schätze den prozentualen Anteil dieser Portion am Gesamtgericht anhand der Portionsgröße. Antworte NUR mit JSON:\n{"portion_pct":25,"portion_calories":500,"notes":"Kurze Anmerkung"}`
    : `This is portion ${portionNumber} of ${totalPortions} total portions from a meal prep with ${totalCalories} total calories. Estimate what percentage of the total this portion represents based on its size. Respond ONLY with JSON:\n{"portion_pct":25,"portion_calories":500,"notes":"Brief note"}`

  const res = await fetch('/.netlify/functions/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── Recipe Card ─────────────────────────────────────────────────────────────

function RecipeCard({ recipe, onDelete, lang }) {
  const [expanded, setExpanded] = useState(false)
  const macros = [
    { label: lang === 'de' ? 'Eiweiß' : 'Protein', value: recipe.protein, unit: 'g', color: 'var(--blue)' },
    { label: lang === 'de' ? 'Kohlenhydrate' : 'Carbs', value: recipe.carbs, unit: 'g', color: 'var(--purple)' },
    { label: lang === 'de' ? 'Fett' : 'Fat', value: recipe.fat, unit: 'g', color: 'var(--text2)' },
  ]

  return (
    <div style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{recipe.name}</div>
          {recipe.description && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{recipe.description}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {macros.map(m => m.value && (
              <span key={m.label} style={{ fontSize: 11, color: 'var(--text2)' }}>{m.label} <span style={{ color: m.color, fontWeight: 600 }}>{Math.round(m.value)}{m.unit}</span></span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>{recipe.calories}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>kcal</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '0.2s', flexShrink: 0 }}><path d="M3 5l4 4 4-4" stroke="var(--text3)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {recipe.prep_time && (
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              {lang === 'de' ? 'Zubereitungszeit' : 'Prep time'}: <strong>{recipe.prep_time} min</strong> · {lang === 'de' ? 'Portionen' : 'Servings'}: <strong>{recipe.servings || 1}</strong>
            </div>
          )}

          {recipe.ingredients && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text2)', marginBottom: 6 }}>
                {lang === 'de' ? 'Zutaten' : 'Ingredients'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {(Array.isArray(recipe.ingredients) ? recipe.ingredients : recipe.ingredients.split('\n').filter(Boolean)).map((ing, i) => (
                  <div key={i} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green)', marginTop: 6, flexShrink: 0 }} />
                    {ing}
                  </div>
                ))}
              </div>
            </div>
          )}

          {recipe.instructions && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text2)', marginBottom: 6 }}>
                {lang === 'de' ? 'Zubereitung' : 'Instructions'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{recipe.instructions}</div>
            </div>
          )}

          <button onClick={() => onDelete(recipe.id)} style={{ padding: '8px', borderRadius: 8, background: 'none', border: '0.5px solid rgba(194,48,48,0.25)', color: 'var(--red)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3 4l.7 7.5a1 1 0 001 .9h4.6a1 1 0 001-.9L11 4" stroke="var(--red)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {lang === 'de' ? 'Rezept löschen' : 'Delete recipe'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Recipes Tab ─────────────────────────────────────────────────────────────

function RecipesTab({ session, lang }) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGenerate, setShowGenerate] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedRecipe, setGeneratedRecipe] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', calories: '', protein: '', carbs: '', fat: '', servings: '1', prep_time: '', ingredients: '', instructions: '' })

  async function fetchRecipes() {
    const { data } = await supabase.from('recipes').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false })
    setRecipes(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchRecipes() }, [])

  async function handleGenerate() {
    if (!prompt.trim()) return
    setGenerating(true)
    try {
      const recipe = await generateRecipeFromPrompt(prompt, lang)
      setGeneratedRecipe(recipe)
    } catch (e) {
      showToast(lang === 'de' ? 'Generierung fehlgeschlagen' : 'Generation failed')
    }
    setGenerating(false)
  }

  async function saveGeneratedRecipe() {
    if (!generatedRecipe) return
    const { error } = await supabase.from('recipes').insert({
      user_id: session.user.id,
      ...generatedRecipe,
      ingredients: Array.isArray(generatedRecipe.ingredients) ? generatedRecipe.ingredients.join('\n') : generatedRecipe.ingredients,
    })
    if (!error) {
      showToast(lang === 'de' ? 'Rezept gespeichert' : 'Recipe saved')
      setGeneratedRecipe(null)
      setShowGenerate(false)
      setPrompt('')
      fetchRecipes()
    }
  }

  async function saveManualRecipe() {
    const { error } = await supabase.from('recipes').insert({
      user_id: session.user.id,
      name: form.name,
      description: form.description,
      calories: parseInt(form.calories) || null,
      protein: parseFloat(form.protein) || null,
      carbs: parseFloat(form.carbs) || null,
      fat: parseFloat(form.fat) || null,
      servings: parseInt(form.servings) || 1,
      prep_time: parseInt(form.prep_time) || null,
      ingredients: form.ingredients,
      instructions: form.instructions,
    })
    if (!error) {
      showToast(lang === 'de' ? 'Rezept gespeichert' : 'Recipe saved')
      setShowManual(false)
      setForm({ name: '', description: '', calories: '', protein: '', carbs: '', fat: '', servings: '1', prep_time: '', ingredients: '', instructions: '' })
      fetchRecipes()
    }
  }

  async function deleteRecipe(id) {
    await supabase.from('recipes').delete().eq('id', id)
    fetchRecipes()
    showToast(lang === 'de' ? 'Rezept gelöscht' : 'Recipe deleted')
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* AI Generate button */}
      <button onClick={() => setShowGenerate(true)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '0.5px solid var(--green-border)', background: 'rgba(26,122,94,0.04)', cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1l1.5 3.5 3.5.5-2.5 2.5.5 3.5L9 9.5l-3 1.5.5-3.5L4 5l3.5-.5L9 1z" stroke="var(--green)" strokeWidth="1.2" strokeLinejoin="round"/></svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{lang === 'de' ? 'Rezept generieren' : 'Generate a recipe'}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{lang === 'de' ? 'Beschreibe was du willst · KI erstellt es mit Kalorien' : 'Describe what you want · AI builds it with calories'}</div>
        </div>
      </button>

      {/* Recipes list */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">{lang === 'de' ? 'Meine Rezepte' : 'My recipes'}</span>
          <span className="badge badge-green">{recipes.length} {lang === 'de' ? 'gespeichert' : 'saved'}</span>
        </div>
        {loading ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>Loading...</div>
        ) : recipes.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
            {lang === 'de' ? 'Noch keine Rezepte. Generiere oder füge eines hinzu.' : 'No recipes yet. Generate or add one above.'}
          </div>
        ) : (
          recipes.map(r => <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} lang={lang} />)
        )}
        <div style={{ padding: '10px 14px' }}>
          <button onClick={() => setShowManual(true)} style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px dashed var(--border2)', background: 'none', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            {lang === 'de' ? 'Rezept manuell hinzufügen' : 'Add recipe manually'}
          </button>
        </div>
      </div>

      {/* Generate sheet */}
      {showGenerate && (
        <div className="sheet-overlay" onClick={() => { setShowGenerate(false); setGeneratedRecipe(null); setPrompt('') }}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{lang === 'de' ? 'Rezept generieren' : 'Generate a recipe'}</div>
            <div className="sheet-divider" />
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {!generatedRecipe ? (
                <>
                  <div className="field">
                    <label className="field-label">{lang === 'de' ? 'Was möchtest du kochen?' : 'What do you want to make?'}</label>
                    <textarea
                      className="field-input"
                      style={{ minHeight: 80, resize: 'none', lineHeight: 1.5 }}
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      placeholder={lang === 'de' ? 'z.B. Hochprotein-Frühstück mit Eiern, unter 500 Kalorien' : 'e.g. High protein breakfast with eggs, under 500 calories'}
                    />
                  </div>
                  <button className="btn-primary" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
                    {generating ? (lang === 'de' ? 'Generiere...' : 'Generating...') : (lang === 'de' ? 'Rezept erstellen' : 'Create recipe')}
                  </button>
                  {generating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', color: 'var(--text2)', fontSize: 13 }}>
                      <div className="spinner" style={{ width: 18, height: 18 }} />
                      {lang === 'de' ? 'KI erstellt dein Rezept...' : 'AI is building your recipe...'}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{generatedRecipe.name}</div>
                    {generatedRecipe.description && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{generatedRecipe.description}</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 4 }}>
                      {[
                        { label: 'kcal', value: generatedRecipe.calories, color: 'var(--amber)' },
                        { label: lang === 'de' ? 'Eiweiß' : 'Protein', value: `${generatedRecipe.protein}g`, color: 'var(--blue)' },
                        { label: lang === 'de' ? 'Kohlenhydrate' : 'Carbs', value: `${generatedRecipe.carbs}g`, color: 'var(--purple)' },
                        { label: lang === 'de' ? 'Fett' : 'Fat', value: `${generatedRecipe.fat}g`, color: 'var(--text2)' },
                      ].map(m => (
                        <div key={m.label} style={{ background: 'var(--surface)', borderRadius: 8, padding: '7px 6px', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: m.color }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    {generatedRecipe.prep_time && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{lang === 'de' ? 'Zubereitungszeit' : 'Prep time'}: {generatedRecipe.prep_time} min</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" onClick={() => { setGeneratedRecipe(null) }}>
                      {lang === 'de' ? 'Neu generieren' : 'Regenerate'}
                    </button>
                    <button className="btn-primary" onClick={saveGeneratedRecipe} style={{ flex: 1 }}>
                      {lang === 'de' ? 'Rezept speichern' : 'Save recipe'}
                    </button>
                  </div>
                </>
              )}
              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}

      {/* Manual add sheet */}
      {showManual && (
        <div className="sheet-overlay" onClick={() => setShowManual(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{lang === 'de' ? 'Rezept hinzufügen' : 'Add recipe'}</div>
            <div className="sheet-divider" />
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field"><label className="field-label">{lang === 'de' ? 'Name' : 'Name'}</label><input className="field-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="field"><label className="field-label">{lang === 'de' ? 'Beschreibung' : 'Description'}</label><input className="field-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="field"><label className="field-label">{lang === 'de' ? 'Kalorien' : 'Calories'}</label><input className="field-input" type="number" value={form.calories} onChange={e => setForm(f => ({ ...f, calories: e.target.value }))} inputMode="numeric" /></div>
                <div className="field"><label className="field-label">{lang === 'de' ? 'Portionen' : 'Servings'}</label><input className="field-input" type="number" value={form.servings} onChange={e => setForm(f => ({ ...f, servings: e.target.value }))} inputMode="numeric" /></div>
                <div className="field"><label className="field-label">{lang === 'de' ? 'Eiweiß (g)' : 'Protein (g)'}</label><input className="field-input" type="number" value={form.protein} onChange={e => setForm(f => ({ ...f, protein: e.target.value }))} inputMode="decimal" /></div>
                <div className="field"><label className="field-label">{lang === 'de' ? 'Kohlenhydrate (g)' : 'Carbs (g)'}</label><input className="field-input" type="number" value={form.carbs} onChange={e => setForm(f => ({ ...f, carbs: e.target.value }))} inputMode="decimal" /></div>
                <div className="field"><label className="field-label">{lang === 'de' ? 'Fett (g)' : 'Fat (g)'}</label><input className="field-input" type="number" value={form.fat} onChange={e => setForm(f => ({ ...f, fat: e.target.value }))} inputMode="decimal" /></div>
                <div className="field"><label className="field-label">{lang === 'de' ? 'Zubereitungszeit (min)' : 'Prep time (min)'}</label><input className="field-input" type="number" value={form.prep_time} onChange={e => setForm(f => ({ ...f, prep_time: e.target.value }))} inputMode="numeric" /></div>
              </div>
              <div className="field">
                <label className="field-label">{lang === 'de' ? 'Zutaten (eine pro Zeile)' : 'Ingredients (one per line)'}</label>
                <textarea className="field-input" style={{ minHeight: 80, resize: 'none', lineHeight: 1.5 }} value={form.ingredients} onChange={e => setForm(f => ({ ...f, ingredients: e.target.value }))} placeholder={lang === 'de' ? '200g Hähnchenbrust\n100g Reis' : '200g chicken breast\n100g rice'} />
              </div>
              <div className="field">
                <label className="field-label">{lang === 'de' ? 'Zubereitung' : 'Instructions'}</label>
                <textarea className="field-input" style={{ minHeight: 80, resize: 'none', lineHeight: 1.5 }} value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setShowManual(false)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</button>
                <button className="btn-primary" onClick={saveManualRecipe} disabled={!form.name || !form.calories} style={{ flex: 1 }}>{lang === 'de' ? 'Speichern' : 'Save'}</button>
              </div>
              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Meal Prep Tab ────────────────────────────────────────────────────────────

function MealPrepTab({ session, lang }) {
  const [preps, setPreps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [step, setStep] = useState(1)
  const [prepName, setPrepName] = useState('')
  const [ingredientDesc, setIngredientDesc] = useState('')
  const [analysing, setAnalysing] = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [portionCount, setPortionCount] = useState(4)
  const [portionPhotos, setPortionPhotos] = useState([])
  const [analysingPortion, setAnalysingPortion] = useState(false)
  const portionFileRef = useRef()
  const ingredientFileRef = useRef()

  async function fetchPreps() {
    const { data } = await supabase
      .from('meal_preps')
      .select('*, meal_prep_portions(*)')
      .eq('user_id', session.user.id)
      .order('cook_date', { ascending: false })
    setPreps(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchPreps() }, [])

  async function handleIngredientPhoto(file) {
    if (!file) return
    const base64 = await fileToBase64(file)
    const mimeType = file.type || 'image/jpeg'
    setIngredientDesc(prev => prev + (prev ? '\n' : '') + `[Photo uploaded: ${file.name}]`)
    // Analyse immediately
    setAnalysing(true)
    try {
      const res = await fetch('/.netlify/functions/claude-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: 'List the food ingredients you can see in this image, including estimated quantities. Be concise.' }
            ]
          }]
        })
      })
      const data = await res.json()
      const description = data.content?.[0]?.text || ''
      setIngredientDesc(prev => prev.replace(`[Photo uploaded: ${file.name}]`, description))
    } catch (e) {
      setIngredientDesc(prev => prev.replace(`[Photo uploaded: ${file.name}]`, '[Could not analyse photo]'))
    }
    setAnalysing(false)
  }

  async function analyseBatch() {
    if (!ingredientDesc.trim()) return
    setAnalysing(true)
    try {
      const result = await analyseMealPrepIngredients(ingredientDesc, lang)
      setBatchResult(result)
      setStep(3)
    } catch (e) {
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setAnalysing(false)
  }

  async function handlePortionPhoto(file) {
    if (!file || !batchResult) return
    setAnalysingPortion(true)
    try {
      const base64 = await fileToBase64(file)
      const mimeType = file.type || 'image/jpeg'
      const portionNum = portionPhotos.length + 1
      const result = await analysePortionPhoto(base64, mimeType, batchResult.total_calories, portionNum, portionCount, lang)
      const objectUrl = URL.createObjectURL(file)
      setPortionPhotos(prev => [...prev, { ...result, objectUrl, portionNum }])
    } catch (e) {
      showToast(lang === 'de' ? 'Analyse fehlgeschlagen' : 'Analysis failed')
    }
    setAnalysingPortion(false)
  }

  async function saveMealPrep() {
    const portionCalories = portionPhotos.length > 0
      ? Math.round(portionPhotos.reduce((a, p) => a + p.portion_calories, 0) / portionPhotos.length)
      : Math.round(batchResult.total_calories / portionCount)

    const { data: prep, error } = await supabase.from('meal_preps').insert({
      user_id: session.user.id,
      name: prepName,
      cook_date: format(new Date(), 'yyyy-MM-dd'),
      total_calories: batchResult.total_calories,
      total_portions: portionCount,
      portions_remaining: portionCount,
      notes: batchResult.notes,
    }).select().single()

    if (error || !prep) { showToast('Error saving'); return }

    // Save portions
    const portions = Array.from({ length: portionCount }, (_, i) => ({
      meal_prep_id: prep.id,
      user_id: session.user.id,
      portion_number: i + 1,
      calories: portionPhotos[i]?.portion_calories || portionCalories,
      used: false,
    }))
    await supabase.from('meal_prep_portions').insert(portions)

    showToast(lang === 'de' ? 'Mahlzeitvorbereitung gespeichert' : 'Meal prep saved')
    setShowNew(false)
    setStep(1)
    setPrepName('')
    setIngredientDesc('')
    setBatchResult(null)
    setPortionPhotos([])
    fetchPreps()
  }

  async function usePortionFromPrep(prepId, portionId, calories) {
    const today = format(new Date(), 'yyyy-MM-dd')
    await supabase.from('meal_prep_portions').update({ used: true, used_date: today }).eq('id', portionId)
    await supabase.from('meal_preps').update({ portions_remaining: supabase.raw('portions_remaining - 1') }).eq('id', prepId)

    // Log as a meal
    await supabase.from('meal_logs').insert({
      user_id: session.user.id,
      date: today,
      meal_name: 'Meal prep portion',
      meal_type: 'lunch',
      calories,
      source: 'meal_prep',
    })
    showToast(lang === 'de' ? 'Portion protokolliert' : 'Portion logged')
    fetchPreps()
  }

  const resetNew = () => { setShowNew(false); setStep(1); setPrepName(''); setIngredientDesc(''); setBatchResult(null); setPortionPhotos([]) }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      <button onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '0.5px solid var(--green-border)', background: 'rgba(26,122,94,0.04)', cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="5" width="12" height="10" rx="2" stroke="var(--green)" strokeWidth="1.3"/><path d="M6 5V3.5a2 2 0 014 0V5M6.5 10h5M9 8v4" stroke="var(--green)" strokeWidth="1.2" strokeLinecap="round"/></svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{lang === 'de' ? 'Neue Mahlzeitvorbereitung' : 'New meal prep'}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{lang === 'de' ? 'Zutaten foto/beschreiben → Kalorien berechnen → Portionen aufteilen' : 'Photo/describe ingredients → calculate calories → split into portions'}</div>
        </div>
      </button>

      {/* Existing preps */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13, padding: 20 }}>Loading...</div>
      ) : preps.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13, padding: 20 }}>
          {lang === 'de' ? 'Noch keine Mahlzeitvorbereitungen.' : 'No meal preps yet.'}
        </div>
      ) : (
        preps.map(prep => {
          const remaining = prep.meal_prep_portions?.filter(p => !p.used).length || prep.portions_remaining
          const used = (prep.total_portions || 0) - remaining
          return (
            <div key={prep.id} className="card">
              <div style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{prep.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                      {lang === 'de' ? 'Gekocht' : 'Cooked'} {format(new Date(prep.cook_date), 'd MMM')} · {prep.total_portions} {lang === 'de' ? 'Portionen' : 'portions'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{prep.total_calories}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>kcal total</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                  {(prep.meal_prep_portions || []).map(p => (
                    <button key={p.id} onClick={() => !p.used && usePortionFromPrep(prep.id, p.id, p.calories)} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: p.used ? 'default' : 'pointer', fontFamily: 'inherit', border: 'none', background: p.used ? 'var(--surface2)' : 'rgba(26,122,94,0.1)', color: p.used ? 'var(--text3)' : 'var(--green)', textDecoration: p.used ? 'line-through' : 'none' }}>
                      P{p.portion_number} {p.calories ? `· ${p.calories}` : ''}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  {remaining} {lang === 'de' ? 'Portionen übrig' : 'portions remaining'} · ~{Math.round((prep.total_calories || 0) / (prep.total_portions || 1))} kcal {lang === 'de' ? 'pro Portion' : 'per portion'}
                </div>
              </div>
            </div>
          )
        })
      )}

      {/* New meal prep sheet */}
      {showNew && (
        <div className="sheet-overlay" onClick={resetNew}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">
              {step === 1 ? (lang === 'de' ? 'Mahlzeitvorbereitung benennen' : 'Name your meal prep') :
               step === 2 ? (lang === 'de' ? 'Zutaten beschreiben' : 'Describe ingredients') :
               (lang === 'de' ? 'Portionen aufteilen' : 'Divide into portions')}
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', gap: 6, padding: '0 16px 14px', justifyContent: 'center' }}>
              {[1,2,3].map(s => (
                <div key={s} style={{ width: s === step ? 20 : 8, height: 8, borderRadius: 4, background: s === step ? 'var(--green)' : s < step ? 'var(--green-border)' : 'var(--surface2)', transition: 'all 0.2s' }} />
              ))}
            </div>

            <div className="sheet-divider" style={{ marginTop: 0 }} />

            {step === 1 && (
              <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="field">
                  <label className="field-label">{lang === 'de' ? 'Name' : 'Name'}</label>
                  <input className="field-input" value={prepName} onChange={e => setPrepName(e.target.value)} placeholder={lang === 'de' ? 'z.B. Hähnchen & Reis Batch' : 'e.g. Chicken & rice batch'} />
                </div>
                <div className="field">
                  <label className="field-label">{lang === 'de' ? 'Anzahl Portionen' : 'Number of portions'}</label>
                  <input className="field-input" type="number" value={portionCount} onChange={e => setPortionCount(parseInt(e.target.value) || 4)} inputMode="numeric" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }} />
                </div>
                <button className="btn-primary" onClick={() => setStep(2)} disabled={!prepName}>{lang === 'de' ? 'Weiter' : 'Next'}</button>
                <div style={{ height: 4 }} />
              </div>
            )}

            {step === 2 && (
              <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                  {lang === 'de' ? 'Fotos der Zutaten machen oder beschreiben was du verwendet hast.' : 'Take photos of ingredients or describe what you used.'}
                </div>

                <input ref={ingredientFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleIngredientPhoto(e.target.files[0])} />
                <button onClick={() => ingredientFileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--green-border)', background: 'rgba(26,122,94,0.03)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="11" rx="2" stroke="var(--green)" strokeWidth="1.3"/><circle cx="8" cy="7.5" r="2.5" stroke="var(--green)" strokeWidth="1.3"/><path d="M5.5 2L6.3 1h3.4L10.5 2" stroke="var(--green)" strokeWidth="1.3"/></svg>
                  <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>{lang === 'de' ? 'Zutaten fotografieren' : 'Photo ingredients'}</span>
                </button>

                <div className="field">
                  <label className="field-label">{lang === 'de' ? 'Oder beschreiben' : 'Or describe'}</label>
                  <textarea className="field-input" style={{ minHeight: 100, resize: 'none', lineHeight: 1.5 }} value={ingredientDesc} onChange={e => setIngredientDesc(e.target.value)} placeholder={lang === 'de' ? 'z.B. 800g Hähnchenbrust, 400g Reis, 2 Paprika, Olivenöl...' : 'e.g. 800g chicken breast, 400g rice, 2 peppers, olive oil...'} />
                </div>

                {analysing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 13 }}>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                    {lang === 'de' ? 'Analysiere Zutaten...' : 'Analysing ingredients...'}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setStep(1)}>{lang === 'de' ? 'Zurück' : 'Back'}</button>
                  <button className="btn-primary" onClick={analyseBatch} disabled={analysing || !ingredientDesc.trim()} style={{ flex: 1 }}>
                    {lang === 'de' ? 'Kalorien berechnen' : 'Calculate calories'}
                  </button>
                </div>
                <div style={{ height: 4 }} />
              </div>
            )}

            {step === 3 && batchResult && (
              <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Batch total */}
                <div style={{ background: 'var(--green-light)', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '0.5px solid var(--green-border)' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>{lang === 'de' ? 'Gesamtkalorien Batch' : 'Total batch calories'}</div>
                    {batchResult.notes && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{batchResult.notes}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{batchResult.total_calories}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>kcal total</div>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                  ~{Math.round(batchResult.total_calories / portionCount)} kcal {lang === 'de' ? 'pro Portion (gleichmäßig aufgeteilt)' : 'per portion (equal split)'}
                </div>

                {/* Portion photos */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text2)', marginBottom: 8 }}>
                    {lang === 'de' ? 'Portionsfotos (optional)' : 'Portion photos (optional)'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.5 }}>
                    {lang === 'de' ? 'Fotografiere jede Portion um genaue Kalorienverteilung zu berechnen.' : 'Photo each portion for accurate calorie distribution.'}
                  </div>

                  <input ref={portionFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handlePortionPhoto(e.target.files[0])} />

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {portionPhotos.map(p => (
                      <div key={p.portionNum} style={{ textAlign: 'center' }}>
                        <img src={p.objectUrl} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: '0.5px solid var(--border)' }} />
                        <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600, marginTop: 2 }}>P{p.portionNum}</div>
                        <div style={{ fontSize: 10, color: 'var(--text2)' }}>{p.portion_calories} kcal</div>
                      </div>
                    ))}
                    {portionPhotos.length < portionCount && (
                      <button onClick={() => portionFileRef.current?.click()} style={{ width: 52, height: 52, borderRadius: 8, border: '1px dashed var(--border2)', background: 'var(--surface2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="var(--text2)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      </button>
                    )}
                  </div>

                  {analysingPortion && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12 }}>
                      <div className="spinner" style={{ width: 14, height: 14 }} />
                      {lang === 'de' ? 'Analysiere Portion...' : 'Analysing portion...'}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setStep(2)}>{lang === 'de' ? 'Zurück' : 'Back'}</button>
                  <button className="btn-primary" onClick={saveMealPrep} style={{ flex: 1 }}>
                    {lang === 'de' ? 'Speichern' : 'Save meal prep'}
                  </button>
                </div>
                <div style={{ height: 4 }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Food Page ───────────────────────────────────────────────────────────

export default function FoodPage({ session }) {
  const { t, lang } = useLang()
  const [tab, setTab] = useState('recipes')

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">{lang === 'de' ? 'Essen' : 'Food'}</div>
          <div className="page-header-sub">{lang === 'de' ? 'Rezepte & Mahlzeitvorbereitung' : 'Recipes & meal prep'}</div>
        </div>
      </div>

      <div className="tabs-bar">
        <button className={`tab-btn ${tab === 'recipes' ? 'active' : ''}`} onClick={() => setTab('recipes')}>
          {lang === 'de' ? 'Rezepte' : 'Recipes'}
        </button>
        <button className={`tab-btn ${tab === 'mealprep' ? 'active' : ''}`} onClick={() => setTab('mealprep')}>
          {lang === 'de' ? 'Meal Prep' : 'Meal prep'}
        </button>
      </div>

      {tab === 'recipes' && <RecipesTab session={session} lang={lang} />}
      {tab === 'mealprep' && <MealPrepTab session={session} lang={lang} />}

      <Toast />
    </>
  )
}
