const { createClient } = require('@supabase/supabase-js')

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

async function refreshToken(supabase, userId, refreshToken) {
  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
    }),
  })

  if (!res.ok) throw new Error('Failed to refresh WHOOP token')
  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabase.from('whoop_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId)

  return tokens.access_token
}

async function whoopFetch(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`WHOOP API error: ${res.status} ${url}`)
  return res.json()
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const { user_id } = JSON.parse(event.body || '{}')
    if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing user_id' }) }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Get stored tokens
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('whoop_tokens')
      .select('*')
      .eq('user_id', user_id)
      .single()

    if (tokenErr || !tokenRow) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'WHOOP not connected' }) }
    }

    // Refresh token if expired (with 5 min buffer)
    let accessToken = tokenRow.access_token
    if (new Date(tokenRow.expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
      accessToken = await refreshToken(supabase, user_id, tokenRow.refresh_token)
    }

    // Fetch last 2 days of sleep data from WHOOP
    const today = new Date()
    const twoDaysAgo = new Date(today)
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    const startDate = twoDaysAgo.toISOString().split('T')[0]

    const [sleepData, recoveryData, cycleData] = await Promise.all([
      whoopFetch(`https://api.prod.whoop.com/developer/v1/activity/sleep?start=${startDate}T00:00:00.000Z&limit=5`, accessToken),
      whoopFetch(`https://api.prod.whoop.com/developer/v1/recovery?start=${startDate}T00:00:00.000Z&limit=5`, accessToken),
      whoopFetch(`https://api.prod.whoop.com/developer/v1/cycle?start=${startDate}T00:00:00.000Z&limit=5`, accessToken),
    ])

    const synced = []

    // Process each sleep record
    for (const sleep of (sleepData.records || [])) {
      if (!sleep.end) continue // skip in-progress sleep

      const sleepDate = new Date(sleep.end)
      // WHOOP sleep ends in the morning - attribute to the day it ends
      const dateStr = sleepDate.toISOString().split('T')[0]

      const stage = sleep.score?.stage_summary || {}
      const totalMs = sleep.score?.total_in_bed_time_milli || 0
      const sleepMs = sleep.score?.total_sleep_time_milli || totalMs
      const lightMs = stage.total_light_sleep_time_milli || 0
      const remMs = stage.total_rem_sleep_time_milli || 0
      const slowWaveMs = stage.total_slow_wave_sleep_time_milli || 0
      const awakeMs = stage.total_awake_time_milli || 0

      const sleepDuration = +(sleepMs / 3600000).toFixed(2)
      const restorativeHours = +((remMs + slowWaveMs) / 3600000).toFixed(2)
      const efficiency = totalMs > 0 ? +((sleepMs / totalMs) * 100).toFixed(1) : null
      const awakePct = totalMs > 0 ? +((awakeMs / totalMs) * 100).toFixed(1) : null

      // Find matching recovery for this sleep
      const recovery = (recoveryData.records || []).find(r => {
        const rd = new Date(r.created_at).toISOString().split('T')[0]
        return rd === dateStr
      })

      const updates = {
        sleep_duration: sleepDuration,
        sleep_restorative: restorativeHours,
        sleep_efficiency: efficiency,
        sleep_awake_pct: awakePct,
      }

      if (recovery?.score) {
        updates.recovery_score = recovery.score.recovery_score
        updates.hrv = +(recovery.score.hrv_rmssd_milli).toFixed(1)
        updates.rhr = +((recovery.score.resting_heart_rate || 0)).toFixed(0)
      }

      // Upsert into daily_logs
      const { error } = await supabase.from('daily_logs').upsert({
        user_id,
        date: dateStr,
        ...updates,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })

      if (!error) synced.push(dateStr)
    }

    // Update last synced timestamp
    await supabase.from('whoop_tokens').update({
      last_synced_at: new Date().toISOString(),
    }).eq('user_id', user_id)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, synced_dates: synced }),
    }

  } catch (err) {
    console.error('Sync error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
