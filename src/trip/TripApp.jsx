import { useState } from 'react'
import { supabase } from '../lib/supabase'
import TripList from './TripList'
import TripView from './TripView'
import './trip.css'

export default function TripApp({ session }) {
  const [activeTrip, setActiveTrip] = useState(null)

  if (activeTrip) return (
    <TripView trip={activeTrip} session={session} onBack={() => setActiveTrip(null)} />
  )
  return <TripList session={session} onSelectTrip={setActiveTrip} />
}
