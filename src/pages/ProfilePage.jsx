import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useData'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'
import { format } from 'date-fns'

const WHOOP_CLIENT_ID = import.meta.env.VITE_WHOOP_CLIENT_ID
const REDIRECT_URI = 'https://sebs.health/whoop-callback'

function generateShortcutToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export default function ProfilePage({ session }) {
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

  useEffect(() => {
    checkWhoopStatus()
    loadShortcutToken()
  }, [session.user.id])

  useEffect(() => {
    if (settings) {
      setCalorieTarget(settings.calorie_target || 1900)
      setWaterTarget(settings.water_target || 2500)
      setStepsTarget(settings.steps_target || 10000)
      setTargetWeight(settings.target_weight || '')
      setStartWeight(settings.start_weight || '')
    }
  }, [settings])

  // Handle WHOOP callback on page load
  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (code && state === 'whoop') {
      handleWhoopCallback(code)
      window.history.replaceState({}, '', '/')
    }
  }, [])

  async function checkWhoopStatus() {
    const { data } = await supabase
      .from('whoop_tokens')
      .select('last_synced_at, whoop_user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
    setWhoopStatus(data)
  }

  async function loadShortcutToken() {
    const { data } = await supabase
      .from('user_settings')
      .select('shortcut_token')
      .eq('user_id', session.user.id)
      .maybeSingle()
    if (data?.shortcut_token) setShortcutToken(data.shortcut_token)
  }

  function connectWhoop() {
    const params = new URLSearchParams({
      client_id: WHOOP_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'offline read:recovery read:sleep read:profile read:cycles',
      state: 'whoop',
    })
    window.location.href = `https://api.prod.whoop.com/oauth/oauth2/auth?${params}`
  }

  async function handleWhoopCallback(code) {
    setSyncing(true)
    try {
      const res = await fetch('/.netlify/functions/whoop-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          user_id: session.user.id,
          redirect_uri: REDIRECT_URI,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('WHOOP connected!')
        checkWhoopStatus()
        syncWhoop()
      } else {
        showToast('WHOOP connection failed')
      }
    } catch (e) {
      showToast('Connection error')
    }
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
      if (data.success) {
        showToast(`Synced ${data.synced_dates?.length || 0} days`)
        checkWhoopStatus()
      } else {
        showToast(data.error || 'Sync failed')
      }
    } catch (e) {
      showToast('Sync error')
    }
    setSyncing(false)
  }

  async function disconnectWhoop() {
    await supabase.from('whoop_tokens').delete().eq('user_id', session.user.id)
    setWhoopStatus(null)
    showToast('WHOOP disconnected')
  }

  async function generateAndSaveToken() {
    const token = generateShortcutToken()
    await supabase.from('user_settings').upsert({
      user_id: session.user.id,
      shortcut_token: token,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
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
    showToast('Settings saved')
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const shortcutUrl = shortcutToken
    ? `https://sebs.health/.netlify/functions/apple-health-sync`
    : null

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">Profile</div>
          <div className="page-header-sub">{session.user.email}</div>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: 'var(--green)' }}>
          {session.user.email?.[0]?.toUpperCase()}
        </div>
      </div>

      <div className="page-section">

        {/* WHOOP */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">WHOOP</span>
            <span className="badge" style={{ background: whoopStatus ? 'var(--green-light)' : 'var(--surface2)', color: whoopStatus ? 'var(--green)' : 'var(--text2)', border: whoopStatus ? 'none' : '0.5px solid var(--border)' }}>
              {whoopStatus ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {whoopStatus ? (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Syncing sleep &amp; recovery</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {whoopStatus.last_synced_at
                      ? `Last synced ${format(new Date(whoopStatus.last_synced_at), 'd MMM · HH:mm')}`
                      : 'Not yet synced'}
                  </div>
                </div>
                <button onClick={syncWhoop} disabled={syncing} style={{ padding: '7px 14px', borderRadius: 20, background: 'var(--green-light)', border: 'none', color: 'var(--green)', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {syncing ? 'Syncing...' : 'Sync now'}
                </button>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}>
                Pulls: sleep duration, efficiency, restorative sleep, recovery score, HRV, RHR
              </div>

              <button onClick={disconnectWhoop} style={{ padding: '9px', borderRadius: 8, background: 'none', border: '0.5px solid var(--border)', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                Disconnect WHOOP
              </button>
            </div>
          ) : (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                Connect WHOOP to automatically sync your sleep, recovery score, HRV, and RHR every day.
              </div>
              <button onClick={connectWhoop} style={{ padding: '11px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                Connect WHOOP
              </button>
            </div>
          )}
        </div>

        {/* Apple Health */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Apple Health</span>
            <span className="badge" style={{ background: shortcutToken ? 'var(--green-light)' : 'var(--surface2)', color: shortcutToken ? 'var(--green)' : 'var(--text2)', border: shortcutToken ? 'none' : '0.5px solid var(--border)' }}>
              {shortcutToken ? 'Shortcut ready' : 'Not set up'}
            </span>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
              Syncs weight from Renpho and daily steps via an iPhone Shortcut. One tap each morning.
            </div>

            {shortcutToken ? (
              <>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Your sync endpoint</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', wordBreak: 'break-all' }}>
                    {shortcutUrl}
                  </div>
                </div>
                <button onClick={() => setShowShortcutSetup(true)} style={{ padding: '9px', borderRadius: 8, background: 'var(--green-light)', border: 'none', color: 'var(--green)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  View Shortcut setup guide
                </button>
              </>
            ) : (
              <button onClick={generateAndSaveToken} style={{ padding: '11px', borderRadius: 8, background: 'var(--green)', border: 'none', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                Set up Apple Health sync
              </button>
            )}
          </div>
        </div>

        {/* Targets & settings */}
        <div className="card">
          <div className="card-header"><span className="card-title">Daily targets</span></div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label className="field-label">Calories (kcal)</label>
                <input className="field-input" type="number" value={calorieTarget} onChange={e => setCalorieTarget(e.target.value)} inputMode="numeric" />
              </div>
              <div className="field">
                <label className="field-label">Water (ml)</label>
                <input className="field-input" type="number" value={waterTarget} onChange={e => setWaterTarget(e.target.value)} inputMode="numeric" />
              </div>
              <div className="field">
                <label className="field-label">Steps</label>
                <input className="field-input" type="number" value={stepsTarget} onChange={e => setStepsTarget(e.target.value)} inputMode="numeric" />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Weight goal</span></div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label className="field-label">Starting weight (kg)</label>
                <input className="field-input" type="number" step="0.1" value={startWeight} onChange={e => setStartWeight(e.target.value)} placeholder="83.8" inputMode="decimal" />
              </div>
              <div className="field">
                <label className="field-label">Target weight (kg)</label>
                <input className="field-input" type="number" step="0.1" value={targetWeight} onChange={e => setTargetWeight(e.target.value)} placeholder="70.0" inputMode="decimal" />
              </div>
            </div>
            {targetWeight && startWeight && (
              <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--green-light)', borderRadius: 8, padding: '8px 10px' }}>
                {(parseFloat(startWeight) - parseFloat(targetWeight)).toFixed(1)} kg to lose · ~{Math.ceil((parseFloat(startWeight) - parseFloat(targetWeight)) / 0.5)} weeks at 0.5 kg/week
              </div>
            )}
            <button className="btn-primary" onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </div>

        {/* Sign out */}
        <button onClick={handleSignOut} style={{ padding: '12px', borderRadius: 10, background: 'none', border: '0.5px solid var(--border)', color: 'var(--text2)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
          Sign out
        </button>

        <div style={{ height: 8 }} />
      </div>

      {/* Shortcut setup guide sheet */}
      {showShortcutSetup && shortcutToken && (
        <div className="sheet-overlay" onClick={() => setShowShortcutSetup(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Apple Health Shortcut setup</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: '0 20px 14px' }}>Takes about 2 minutes on your iPhone</div>
            <div className="sheet-divider" />

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {[
                { n: 1, title: 'Open Shortcuts app on your iPhone', sub: 'Built-in Apple app — search for it if needed' },
                { n: 2, title: 'Tap + to create a new Shortcut', sub: 'Top right corner' },
                { n: 3, title: 'Add action: "Get Health Sample"', sub: 'Search for it · select Weight · Most Recent Sample' },
                { n: 4, title: 'Add another action: "Get Health Sample"', sub: 'Select Step Count · Today' },
                { n: 5, title: 'Add action: "Get Contents of URL"', sub: 'Set Method to POST · URL below' },
              ].map(s => (
                <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--green)', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{s.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{s.sub}</div>
                  </div>
                </div>
              ))}

              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>POST to this URL:</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', wordBreak: 'break-all', marginBottom: 8 }}>
                  https://sebs.health/.netlify/functions/apple-health-sync
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Request body (JSON):</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text)', background: 'var(--surface)', borderRadius: 6, padding: '8px', lineHeight: 1.6 }}>
                  {`{\n  "shortcut_token": "${shortcutToken}",\n  "weight": [Weight Sample],\n  "steps": [Step Count]\n}`}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--green)', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>6</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Name it "Sync health" and add to Home Screen</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>Tap each morning after weighing in</div>
                </div>
              </div>

              <div className="privacy-note">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><rect x="3" y="6.5" width="8" height="6" rx="1.2" stroke="var(--text3)" strokeWidth="1.1"/><path d="M5 6.5V5a2 2 0 014 0v1.5" stroke="var(--text3)" strokeWidth="1.1" strokeLinecap="round"/></svg>
                <div className="privacy-text"><strong>Your token is private.</strong> Only your iPhone Shortcut uses it. Never share this token with anyone.</div>
              </div>

              <button className="btn-primary" onClick={() => setShowShortcutSetup(false)}>Done</button>
              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}

      <Toast />
    </>
  )
}
