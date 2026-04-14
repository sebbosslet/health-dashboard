import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('login')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    let result
    if (mode === 'login') {
      result = await supabase.auth.signInWithPassword({ email, password })
    } else {
      result = await supabase.auth.signUp({ email, password })
    }

    if (result.error) {
      setError(result.error.message)
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '24px'
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: 'var(--green)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 3C8.48 3 4 7.48 4 13s4.48 10 10 10 10-4.48 10-10S19.52 3 14 3zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="white"/>
            </svg>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>sebs.health</div>
          <div style={{ fontSize: 14, color: 'var(--text2)' }}>Your personal health dashboard</div>
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '24px', border: '0.5px solid var(--border)' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
                autoCapitalize="none"
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div style={{ padding: '10px 12px', background: 'var(--red-light)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Loading...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--text2)' }}>
            {mode === 'login' ? (
              <>Don't have an account? <button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Sign up</button></>
            ) : (
              <>Already have an account? <button onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Sign in</button></>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text3)' }}>
          Private · encrypted · only accessible to you
        </div>
      </div>
    </div>
  )
}
