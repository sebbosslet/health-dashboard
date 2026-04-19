import { useState } from 'react'
import TripList from './TripList'
import TripView from './TripView'
import './trip.css'

export default function TripApp({ session }) {
  const [activeTrip, setActiveTrip] = useState(null)

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden', background: '#f5f5f7', WebkitOverflowScrolling: 'touch' }}>
      {activeTrip
        ? <TripView trip={activeTrip} session={session} onBack={() => setActiveTrip(null)} />
        : <TripList session={session} onSelectTrip={setActiveTrip} />
      }
    </div>
  )
}
