import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export function useDailyLog(userId, date) {
  const [log, setLog] = useState(null)
  const [loading, setLoading] = useState(true)

  const dateStr = format(date || new Date(), 'yyyy-MM-dd')

  const fetch = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const { data } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('date', dateStr)
      .maybeSingle()
    setLog(data)
    setLoading(false)
  }, [userId, dateStr])

  useEffect(() => { fetch() }, [fetch])

  async function save(updates) {
    const payload = { ...updates, user_id: userId, date: dateStr, updated_at: new Date().toISOString() }
    const { data, error } = await supabase
      .from('daily_logs')
      .upsert(payload, { onConflict: 'user_id,date' })
      .select()
      .single()
    if (!error) setLog(data)
    return { data, error }
  }

  return { log, loading, save, refetch: fetch }
}

export function useMonthLogs(userId, year, month) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end = `${year}-${String(month).padStart(2, '0')}-31`

    supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end)
      .then(({ data }) => {
        setLogs(data || [])
        setLoading(false)
      })
  }, [userId, year, month])

  return { logs, loading }
}

export function useSettings(userId) {
  const [settings, setSettings] = useState({
    calorie_target: 1900,
    water_target: 2500,
    steps_target: 10000,
    target_weight: null,
    start_weight: null,
  })

  useEffect(() => {
    if (!userId) return
    supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSettings(data)
      })
  }, [userId])

  async function saveSettings(updates) {
    const payload = { ...updates, user_id: userId, updated_at: new Date().toISOString() }
    const { data } = await supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single()
    if (data) setSettings(data)
    return data
  }

  return { settings, saveSettings }
}
