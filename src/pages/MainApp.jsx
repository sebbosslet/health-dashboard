import { useState } from 'react'
import TodayPage from './TodayPage'
import CalendarPage from './CalendarPage'
import TrendsPage from './TrendsPage'
import PhotosPage from './PhotosPage'
import GoalsPage from './GoalsPage'

const NAV = [
  { id: 'today', label: 'Today', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="2" width="8" height="8" rx="2" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <rect x="12" y="2" width="8" height="8" rx="2" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <rect x="2" y="12" width="8" height="8" rx="2" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <rect x="12" y="12" width="8" height="8" rx="2" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
    </svg>
  )},
  { id: 'calendar', label: 'Calendar', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="3" width="18" height="16" rx="2.5" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <path d="M7 2v2M15 2v2M2 9h18" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
  { id: 'trends', label: 'Trends', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M2 17l5-6 4 3 5-7 4 4" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { id: 'photos', label: 'Photos', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="3" width="8" height="10" rx="1.5" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <rect x="12" y="3" width="8" height="10" rx="1.5" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <rect x="2" y="15" width="18" height="3" rx="1.5" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
    </svg>
  )},
  { id: 'goals', label: 'Goals', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="7" r="4" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/>
      <path d="M3 20c0-4.42 3.58-7 8-7s8 2.58 8 7" stroke={active ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
]

export default function MainApp({ session }) {
  const [tab, setTab] = useState('today')

  return (
    <div className="app">
      <div className="page">
        {tab === 'today' && <TodayPage session={session} />}
        {tab === 'calendar' && <CalendarPage session={session} />}
        {tab === 'trends' && <TrendsPage session={session} />}
        {tab === 'photos' && <PhotosPage session={session} />}
        {tab === 'goals' && <GoalsPage session={session} />}
      </div>

      <nav className="bottom-nav">
        {NAV.map(n => (
          <button
            key={n.id}
            className={`nav-item ${tab === n.id ? 'active' : ''}`}
            onClick={() => setTab(n.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {n.icon(tab === n.id)}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
