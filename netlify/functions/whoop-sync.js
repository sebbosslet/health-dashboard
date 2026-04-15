const { createClient } = require('@supabase/supabase-js')

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

async function whoopFetch(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404) {
    console.log(`404 for ${url} - skipping`)
    return { records: [] }
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WHOOP API error: ${res.status} ${url} - ${text}`)
  }
  return res.json()
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

  try {
    const { user_id } = JSON.parse(event.body || '{}')
    if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing user_id' }) }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const { data: tokenRow, error: tokenErr } = await supabase
      .from('whoop_tokens')
      .select('*')
      .eq('user_id', user_id)
      .single()

    if (tokenErr || !tokenRow) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'WHOOP not connected' }) }
    }

    const accessToken = tokenRow.access_token

    // Try to refresh the token if it's expired or close to expiry
    let activeToken = accessToken
    if (tokenRow.refresh_token && tokenRow.refresh_token !== tokenRow.access_token) {
      try {
        const refreshRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokenRow.refresh_token,
            client_id: WHOOP_CLIENT_ID,
            client_secret: WHOOP_CLIENT_SECRET,
          }),
        })
        if (refreshRes.ok) {
          const newTokens = await refreshRes.json()
          activeToken = newTokens.access_token
          await supabase.from('whoop_tokens').update({
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token || tokenRow.refresh_token,
            expires_at: new Date(Date.now() + (newTokens.expires_in || 3600) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('user_id', user_id)
          console.log('Token refreshed successfully')
        }
      } catch (e) {
        console.log('Token refresh failed, using existing token:', e.message)
      }
    }

    // Fetch last 3 days
    const today = new Date()
    const threeDaysAgo = new Date(today)
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const startISO = threeDaysAgo.toISOString()

    console.log('Fetching WHOOP data from', startISO)

    // WHOOP v2 API endpoints
    const [sleepData, recoveryData] = await Promise.all([
      whoopFetch(`https://api.prod.whoop.com/developer/v2/activity/sleep?start=${startISO}&limit=5`, activeToken),
      whoopFetch(`https://api.prod.whoop.com/developer/v2/recovery?start=${startISO}&limit=5`, activeToken),
    ])

    console.log('Sleep records:', sleepData.records?.length || 0)
    console.log('Recovery records:', recoveryData.records?.length || 0)

    const synced = []

    // Process sleep records
    for (const sleep of (sleepData.records || [])) {
      if (!sleep.end) continue

      // WHOOP sleep ends in morning - use end date
      const endDate = new Date(sleep.end)
      const dateStr = endDate.toISOString().split('T')[0]

      const stage = sleep.score?.stage_summary || {}
      const totalMs = sleep.score?.total_in_bed_time_milli || 0
      const sleepMs = sleep.score?.total_sleep_time_milli || totalMs
      const remMs = stage.total_rem_sleep_time_milli || 0
      const slowWaveMs = stage.total_slow_wave_sleep_time_milli || 0
      const awakeMs = stage.total_awake_time_milli || 0

      const sleepDuration = +(sleepMs / 3600000).toFixed(2)
      const restorativeHours = +((remMs + slowWaveMs) / 3600000).toFixed(2)
      const efficiency = totalMs > 0 ? +((sleepMs / totalMs) * 100).toFixed(1) : null
      const awakePct = totalMs > 0 ? +((awakeMs / totalMs) * 100).toFixed(1) : null

      const updates = {
        sleep_duration: sleepDuration,
        sleep_restorative: restorativeHours,
        sleep_efficiency: efficiency,
        sleep_awake_pct: awakePct,
      }

      // Find matching recovery for this date
      const recovery = (recoveryData.records || []).find(r => {
        const rd = new Date(r.created_at || r.updated_at).toISOString().split('T')[0]
        return rd === dateStr
      })

      if (recovery?.score) {
        updates.recovery_score = recovery.score.recovery_score
        updates.hrv = recovery.score.hrv_rmssd_milli
          ? +(recovery.score.hrv_rmssd_milli).toFixed(1)
          : null
        updates.rhr = recovery.score.resting_heart_rate
          ? +recovery.score.resting_heart_rate.toFixed(0)
          : null
      }

      console.log(`Upserting ${dateStr}:`, updates)

      const { error } = await supabase.from('daily_logs').upsert({
        user_id,
        date: dateStr,
        ...updates,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })

      if (error) {
        console.error('Upsert error for', dateStr, JSON.stringify(error))
      } else {
        synced.push(dateStr)
      }
    }

    // Also sync any recovery records that don't have a matching sleep record
    for (const recovery of (recoveryData.records || [])) {
      if (!recovery.score) continue
      const dateStr = new Date(recovery.created_at || recovery.updated_at).toISOString().split('T')[0]
      if (synced.includes(dateStr)) continue // already handled above

      const { error } = await supabase.from('daily_logs').upsert({
        user_id,
        date: dateStr,
        recovery_score: recovery.score.recovery_score,
        hrv: recovery.score.hrv_rmssd_milli ? +(recovery.score.hrv_rmssd_milli).toFixed(1) : null,
        rhr: recovery.score.resting_heart_rate ? +recovery.score.resting_heart_rate.toFixed(0) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })

      if (!error) synced.push(dateStr)
    }

    // Update last synced
    await supabase.from('whoop_tokens').update({
      last_synced_at: new Date().toISOString(),
    }).eq('user_id', user_id)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, synced_dates: synced }),
    }

  } catch (err) {
    console.error('Sync error:', err.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
