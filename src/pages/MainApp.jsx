import { useState } from 'react'
import { useLang } from '../lib/LangContext'
import TodayPage from './TodayPage'
import CalendarPage from './CalendarPage'
import TrendsPage from './TrendsPage'
import PhotosPage from './PhotosPage'
import GoalsPage from './GoalsPage'
import ProfilePage from './ProfilePage'

const NAV_ICONS = {
  today: (a) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="8" height="8" rx="2" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><rect x="12" y="2" width="8" height="8" rx="2" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><rect x="2" y="12" width="8" height="8" rx="2" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><rect x="12" y="12" width="8" height="8" rx="2" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/></svg>,
  calendar: (a) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="3" width="18" height="16" rx="2.5" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><path d="M7 2v2M15 2v2M2 9h18" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round"/></svg>,
  trends: (a) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M2 17l5-6 4 3 5-7 4 4" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  photos: (a) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="3" width="8" height="10" rx="1.5" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><rect x="12" y="3" width="8" height="10" rx="1.5" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><rect x="2" y="15" width="18" height="3" rx="1.5" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/></svg>,
  goals: (a) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="8" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><circle cx="11" cy="11" r="4" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><circle cx="11" cy="11" r="1.5" fill={a ? 'var(--green)' : 'var(--text3)'}/></svg>,
  profile: (a) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7" r="3.5" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5"/><path d="M4 20c0-4 3.13-6 7-6s7 2 7 6" stroke={a ? 'var(--green)' : 'var(--text3)'} strokeWidth="1.5" strokeLinecap="round"/></svg>,
}

const NAV_KEYS = ['today', 'calendar', 'trends', 'photos', 'goals', 'profile']

export default function MainApp({ session }) {
  const [tab, setTab] = useState('today')
  const { t } = useLang()

  return (
    <div className="app">
      <div className="page">
        {tab === 'today' && <TodayPage session={session} />}
        {tab === 'calendar' && <CalendarPage session={session} />}
        {tab === 'trends' && <TrendsPage session={session} />}
        {tab === 'photos' && <PhotosPage session={session} />}
        {tab === 'goals' && <GoalsPage session={session} />}
        {tab === 'profile' && <ProfilePage session={session} />}
      </div>
      <nav className="bottom-nav">
        {NAV_KEYS.map(id => (
          <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            {NAV_ICONS[id](tab === id)}
            <span>{t(`nav_${id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
