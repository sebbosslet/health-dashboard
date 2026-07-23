import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { LangProvider } from './lib/LangContext'
import AuthPage from './pages/AuthPage'
import HubPage from './hub/HubPage'

// Each app is its own chunk — the hub stays instant.
const MainApp = lazy(() => import('./pages/MainApp'))
const TripApp = lazy(() => import('./trip/TripApp'))
const CashflowApp = lazy(() => import('./cashflow/CashflowApp'))

const TRIP_EMAILS = ['trip@sebs.health']

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

  if (!session) {
    return (
      <LangProvider>
        <AuthPage />
      </LangProvider>
    )
  }

  // The trip-only account still lands straight in the travel app.
  const tripOnly = TRIP_EMAILS.includes(session.user.email)

  return (
    <LangProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
        <Routes>
          <Route path="/" element={tripOnly ? <Navigate to="/travel" replace /> : <HubPage session={session} />} />
          <Route path="/health" element={<MainApp session={session} whoopCode={whoopCode} whoopError={whoopError} />} />
          <Route path="/travel" element={<TripApp session={session} />} />
          <Route path="/cashflow" element={<CashflowApp session={session} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </LangProvider>
  )
}
