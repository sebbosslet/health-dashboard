import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { LangProvider } from './lib/LangContext'
import AuthPage from './pages/AuthPage'
import MainApp from './pages/MainApp'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [whoopCode, setWhoopCode] = useState(null)
  const [whoopError, setWhoopError] = useState(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const errorDesc = url.searchParams.get('error_description')

    if (code && state === 'whoop_connect') {
      setWhoopCode(code)
      window.history.replaceState({}, '', '/')
    } else if (error) {
      console.error('WHOOP OAuth error:', error, errorDesc)
      setWhoopError(`${error}: ${errorDesc || 'no description'}`)
      window.history.replaceState({}, '', '/')
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <LangProvider>
        <div className="loading-screen">
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 3C8.48 3 4 7.48 4 13s4.48 10 10 10 10-4.48 10-10S19.52 3 14 3zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="white"/>
            </svg>
          </div>
          <div className="spinner" />
        </div>
      </LangProvider>
    )
  }

  return (
    <LangProvider>
      {!session ? <AuthPage /> : <MainApp session={session} whoopCode={whoopCode} whoopError={whoopError} />}
    </LangProvider>
  )
}
