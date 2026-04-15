import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useData'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'
import { useLang } from '../lib/LangContext'
import LangToggle from '../components/LangToggle'
import { format } from 'date-fns'

const WHOOP_CLIENT_ID = import.meta.env.VITE_WHOOP_CLIENT_ID || '21c05d0f-32b9-4aeb-94c9-3baf5349cb59'
const REDIRECT_URI = 'https://sebs.health/whoop-callback'

function generateShortcutToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function ProfilePage({ session, whoopCode, whoopError }) {
  const { t } = useLang()
  const { settings, saveSettings } = useSettings(session.user.id)
  const [whoopStatus, setWhoopStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [shortcutToken, setShortcutToken] = useState(null)
  const [showShortcutSetup, setShowShortcutSetup] = useState(false)
  const [calorieTarget, setCalorieTarget] = useState('')
  const [waterTarget, setWaterTarget] = useState('')
  const [stepsTarget, setStepsTarget] = useState('')
  const [targetWeight, setTargetWeight] = useState('')
  const [startWeight, setStartWeight] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)

  useEffect(() => { checkWhoopStatus(); loadShortcutToken() }, [session.user.id])

  useEffect(() => {
    if (settings) {
      setCalorieTarget(settings.calorie_target || 1900)
      setWaterTarget(settings.water_target || 2500)
      setStepsTarget(settings.steps_target || 10000)
      setTargetWeight(settings.target_weight || '')
      setStartWeight(settings.start_weight || '')
    }
  }, [settings])

  useEffect(() => {
    if (whoopCode) handleWhoopCallback(whoopCode)
    // Capture any WHOOP OAuth errors
    const url = new URL(window.location.href)
    const error = url.searchParams.get('error')
    const errorDesc = url.searchParams.get('error_description')
    if (error) {
      console.error('WHOOP OAuth error:', error, errorDesc)
      showToast(`WHOOP error: ${error}`)
    }
  }, [whoopCode])

  async function checkWhoopStatus() {
    const { data } = await supabase.from('whoop_tokens').select('last_synced_at, whoop_user_id').eq('user_id', session.user.id).maybeSingle()
    setWhoopStatus(data)
  }

  async function loadShortcutToken() {
    const { data } = await supabase.from('user_settings').select('shortcut_token').eq('user_id', session.user.id).maybeSingle()
    if (data?.shortcut_token) setShortcutToken(data.shortcut_token)
  }

  function connectWhoop() {
    const params = new URLSearchParams({
      client_id: WHOOP_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read:recovery read:sleep read:profile read:cycles read:workout read:body_measurement',
      state: 'whoop_connect',
    })
    const url = `https://api.prod.whoop.com/oauth/oauth2/auth?${params}`
    console.log('WHOOP connect URL:', url)
    window.location.href = url
  }

  async function handleWhoopCallback(code) {
    setSyncing(true)
    try {
      const res = await fetch('/.netlify/functions/whoop-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, user_id: session.user.id, redirect_uri: REDIRECT_URI }),
      })
      const data = await res.json()
      console.log('WHOOP auth response:', data)
      if (data.success) {
        showToast(t('profile_whoop_connected'))
        checkWhoopStatus()
        syncWhoop()
      } else {
        showToast(t('profile_whoop_failed'))
        console.error('WHOOP auth failed:', data)
      }
    } catch { showToast(t('profile_connection_error')) }
    setSyncing(false)
  }

  async function syncWhoop() {
    setSyncing(true)
    try {
      const res = await fetch('/.netlify/functions/whoop-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: session.user.id }),
      })
      const data = await res.json()
      if (data.success) { showToast(`${t('profile_synced')} ${data.synced_dates?.length || 0} ${t('profile_days')}`); checkWhoopStatus() }
      else showToast(data.error || t('profile_sync_failed'))
    } catch { showToast(t('profile_sync_error')) }
    setSyncing(false)
  }

  async function disconnectWhoop() {
    await supabase.from('whoop_tokens').delete().eq('user_id', session.user.id)
    setWhoopStatus(null)
    showToast(t('profile_whoop_disconnected'))
  }

  async function generateAndSaveToken() {
    const token = generateShortcutToken()
    await supabase.from('user_settings').upsert({ user_id: session.user.id, shortcut_token: token, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setShortcutToken(token)
    setShowShortcutSetup(true)
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    await saveSettings({
      calorie_target: parseInt(calorieTarget),
      water_target: parseInt(waterTarget),
      steps_target: parseInt(stepsTarget),
      target_weight: targetWeight ? parseFloat(targetWeight) : null,
      start_weight: startWeight ? parseFloat(startWeight) : null,
    })
    setSavingSettings(false)
    showToast(t('profile_saved'))
  }

  const shortcutSteps = [
    { title: t('shortcut_step1'), sub: t('shortcut_step1_sub') },
    { title: t('shortcut_step2'), sub: t('shortcut_step2_sub') },
    { title: t('shortcut_step3'), sub: t('shortcut_step3_sub') },
    { title: t('shortcut_step4'), sub: t('shortcut_step4_sub') },
    { title: t('shortcut_step5'), sub: t('shortcut_step5_sub') },
    { title: t('shortcut_step6'), sub: t('shortcut_step6_sub') },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">{t('profile_title')}</div>
          <div className="page-header-sub">{session.user.email}</div>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>
          {session.user.email?.[0]?.toUpperCase()}
        </div>
      </div>

      <div className="page-section">

        {/* Language toggle */}
        <div className="card">
          <div className="card-header"><span className="card-title">{t('profile_language')}</span></div>
          <div style={{ padding: '12px 14px' }}>
            <LangToggle />
          </div>
        </div>

        {/* WHOOP */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t('profile_whoop')}</span>
            <span className="badge" style={{ background: whoopStatus ? 'var(--green-light)' : 'var(--surface2)', color: whoopStatus ? 'var(--green)' : 'var(--text2)', border: whoopStatus ? 'none' : '0.5px solid var(--border)' }}>
              {whoopStatus ? t('profile_connected') : t('profile_not_connected')}
            </span>
          </div>
          {whoopError && (
            <div style={{ margin: '0 14px 12px', padding: '10px 12px', background: 'var(--red-light)', borderRadius: 8, fontSize: 12, color: 'var(--red)' }}>
              <strong>WHOOP error:</strong> {whoopError}
            </div>
          )}
          {whoopStatus ? (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t('profile_whoop_syncing')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {whoopStatus.last_synced_at ? `${t('profile_last_synced')} ${format(new Date(whoopStatus.last_synced_at), 'd MMM · HH:mm')}` : t('profile_not_synced')}
                  </div>
                </div>
                <button onClick={syncWhoop} disabled={syncing} style={{ padding: '7px 14px', borderRadius: 20, background: 'var(--green-light)', border: 'none', color: 'var(--green)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {syncing ? t('profile_syncing') : t('profile_sync_now')}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}>{t('profile_whoop_pulls')}</div>
              <button onClick={disconnectWhoop} style={{ padding: '9px', borderRadius: 8, background: 'none', border: '0.5px solid var(--border)', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{t('profile_disconnect_whoop')}</button>
            </div>
          ) : (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{t('profile_whoop_description')}</div>
              <button onClick={connectWhoop} style={{ padding: '11px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>{t('profile_connect_whoop')}</button>
            </div>
          )}
        </div>

        {/* Apple Health */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t('profile_apple')}</span>
            <span className="badge" style={{ background: shortcutToken ? 'var(--green-light)' : 'var(--surface2)', color: shortcutToken ? 'var(--green)' : 'var(--text2)', border: shortcutToken ? 'none' : '0.5px solid var(--border)' }}>
              {shortcutToken ? t('profile_shortcut_ready') : t('profile_not_setup')}
            </span>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{t('profile_apple_description')}</div>
            {shortcutToken ? (
              <>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>{t('profile_sync_endpoint')}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', wordBreak: 'break-all' }}>https://sebs.health/.netlify/functions/apple-health-sync</div>
                </div>
                <button onClick={() => setShowShortcutSetup(true)} style={{ padding: '9px', borderRadius: 8, background: 'var(--green-light)', border: 'none', color: 'var(--green)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{t('profile_view_guide')}</button>
              </>
            ) : (
              <button onClick={generateAndSaveToken} style={{ padding: '11px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>{t('profile_setup_apple')}</button>
            )}
          </div>
        </div>

        {/* Daily targets */}
        <div className="card">
          <div className="card-header"><span className="card-title">{t('profile_targets')}</span></div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field"><label className="field-label">{t('profile_calories_target')}</label><input className="field-input" type="number" value={calorieTarget} onChange={e => setCalorieTarget(e.target.value)} inputMode="numeric" /></div>
              <div className="field"><label className="field-label">{t('profile_water_target')}</label><input className="field-input" type="number" value={waterTarget} onChange={e => setWaterTarget(e.target.value)} inputMode="numeric" /></div>
              <div className="field"><label className="field-label">{t('profile_steps_target')}</label><input className="field-input" type="number" value={stepsTarget} onChange={e => setStepsTarget(e.target.value)} inputMode="numeric" /></div>
            </div>
          </div>
        </div>

        {/* Weight goal */}
        <div className="card">
          <div className="card-header"><span className="card-title">{t('profile_weight_goal')}</span></div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field"><label className="field-label">{t('profile_start_weight')}</label><input className="field-input" type="number" step="0.1" value={startWeight} onChange={e => setStartWeight(e.target.value)} placeholder="83.8" inputMode="decimal" /></div>
              <div className="field"><label className="field-label">{t('profile_target_weight')}</label><input className="field-input" type="number" step="0.1" value={targetWeight} onChange={e => setTargetWeight(e.target.value)} placeholder="70.0" inputMode="decimal" /></div>
            </div>
            {targetWeight && startWeight && (
              <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--green-light)', borderRadius: 8, padding: '8px 10px' }}>
                {(parseFloat(startWeight) - parseFloat(targetWeight)).toFixed(1)} {t('profile_to_lose')} · ~{Math.ceil((parseFloat(startWeight) - parseFloat(targetWeight)) / 0.5)} {t('profile_weeks_at')}
              </div>
            )}
            <button className="btn-primary" onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? t('profile_saving') : t('profile_save_settings')}
            </button>
          </div>
        </div>

        <button onClick={() => supabase.auth.signOut()} style={{ padding: '12px', borderRadius: 10, background: 'none', border: '0.5px solid var(--border)', color: 'var(--text2)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
          {t('profile_sign_out')}
        </button>
        <div style={{ height: 8 }} />
      </div>

      {/* Shortcut guide sheet */}
      {showShortcutSetup && shortcutToken && (
        <div className="sheet-overlay" onClick={() => setShowShortcutSetup(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{t('shortcut_title')}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: '0 20px 14px' }}>{t('shortcut_sub')}</div>
            <div className="sheet-divider" />
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {shortcutSteps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--green)', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div><div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{s.sub}</div></div>
                </div>
              ))}
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>{t('shortcut_post_to')}</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', wordBreak: 'break-all', marginBottom: 8 }}>https://sebs.health/.netlify/functions/apple-health-sync</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>{t('shortcut_body')}</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'var(--surface)', borderRadius: 6, padding: '8px', lineHeight: 1.6 }}>
                  {`{\n  "shortcut_token": "${shortcutToken}",\n  "weight": [Weight Sample],\n  "steps": [Step Count]\n}`}
                </div>
              </div>
              <div className="privacy-note">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><rect x="3" y="6.5" width="8" height="6" rx="1.2" stroke="var(--text3)" strokeWidth="1.1"/><path d="M5 6.5V5a2 2 0 014 0v1.5" stroke="var(--text3)" strokeWidth="1.1" strokeLinecap="round"/></svg>
                <div className="privacy-text"><strong>{t('shortcut_token_private')}</strong> {t('shortcut_token_sub')}</div>
              </div>
              <button className="btn-primary" onClick={() => setShowShortcutSetup(false)}>{t('shortcut_done')}</button>
              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}
      <Toast />
    </>
  )
}
