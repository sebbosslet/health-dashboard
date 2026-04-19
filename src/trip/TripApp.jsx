import { useState } from 'react'
import TripList from './TripList'
import TripView from './TripView'
import './trip.css'

export default function TripApp({ session }) {
  const [activeTrip, setActiveTrip] = useState(null)

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden',
      background: '#f5f5f7', WebkitOverflowScrolling: 'touch',
      colorScheme: 'light',
      '--bg': '#f5f5f7',
      '--surface': '#ffffff',
      '--surface2': '#f5f5f7',
      '--text': '#1c1c1e',
      '--text2': '#636366',
      '--text3': '#aeaeb2',
      '--border': '#e5e5ea',
      '--green': '#2d7a4f',
      '--green-light': '#e8f5ee',
      '--green-border': '#a7d7bc',
    }}>
      {activeTrip
        ? <TripView trip={activeTrip} session={session} onBack={() => setActiveTrip(null)} />
        : <TripList session={session} onSelectTrip={setActiveTrip} />
      }
    </div>
  )
}
