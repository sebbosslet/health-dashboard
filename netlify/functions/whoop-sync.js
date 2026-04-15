const { createClient } = require('@supabase/supabase-js')

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

async function whoopFetch(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WHOOP API error: ${res.status} ${url} - ${text}`)
  }
  return res.json()
}

// Fetch all pages from a WHOOP endpoint using next_token pagination
async function whoopFetchAll(baseUrl, accessToken, maxPages = 5) {
  const allRecords = []
  let nextToken = null
  let page = 0

  do {
    const url = nextToken
      ? `${baseUrl}&next_token=${encodeURIComponent(nextToken)}`
      : baseUrl

    const data = await whoopFetch(url, accessToken)
    allRecords.push(...(data.records || []))
    nextToken = data.next_token || null
    page++
  } while (nextToken && page < maxPages)

  return allRecords
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

    let activeToken = tokenRow.access_token

    // Auto-refresh token if we have a refresh token
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
        console.log('Token refresh failed, using existing:', e.message)
      }
    }

    // Fetch last 30 days with pagination (up to 5 pages of 10 = 50 records)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const startISO = thirtyDaysAgo.toISOString()

    console.log('Fetching WHOOP data from', startISO)

    const [sleepRecords, recoveryRecords] = await Promise.all([
      whoopFetchAll(
        `https://api.prod.whoop.com/developer/v2/activity/sleep?start=${startISO}&limit=10`,
        activeToken,
        5
      ),
      whoopFetchAll(
        `https://api.prod.whoop.com/developer/v2/recovery?start=${startISO}&limit=10`,
        activeToken,
        5
      ),
    ])

    console.log(`Fetched ${sleepRecords.length} sleep records, ${recoveryRecords.length} recovery records`)

    // Build recovery lookup by sleep_id
    const recoveryBySleepId = {}
    for (const r of recoveryRecords) {
      if (r.sleep_id) recoveryBySleepId[r.sleep_id] = r
    }

    const synced = []

    // Process sleep records
    for (const sleep of sleepRecords) {
      if (!sleep.end || sleep.nap) continue
      if (sleep.score_state !== 'SCORED') continue

      const endDate = new Date(sleep.end)
      const dateStr = endDate.toISOString().split('T')[0]

      const stage = sleep.score?.stage_summary || {}
      const totalInBedMs = stage.total_in_bed_time_milli || 0
      const awakeMs = stage.total_awake_time_milli || 0
      const remMs = stage.total_rem_sleep_time_milli || 0
      const slowWaveMs = stage.total_slow_wave_sleep_time_milli || 0
      const actualSleepMs = totalInBedMs - awakeMs

      const sleepDuration = +(actualSleepMs / 3600000).toFixed(2)
      const restorativeHours = +((remMs + slowWaveMs) / 3600000).toFixed(2)
      const efficiency = sleep.score?.sleep_efficiency_percentage
        ? +sleep.score.sleep_efficiency_percentage.toFixed(1)
        : totalInBedMs > 0 ? +((actualSleepMs / totalInBedMs) * 100).toFixed(1) : null
      const awakePct = totalInBedMs > 0 ? +((awakeMs / totalInBedMs) * 100).toFixed(1) : null

      const updates = {
        sleep_duration: sleepDuration,
        sleep_restorative: restorativeHours,
        sleep_efficiency: efficiency,
        sleep_awake_pct: awakePct,
      }

      // Match recovery by sleep_id
      const recovery = recoveryBySleepId[sleep.id]
      if (recovery?.score && recovery.score_state === 'SCORED') {
        updates.recovery_score = recovery.score.recovery_score
        updates.hrv = recovery.score.hrv_rmssd_milli
          ? +(recovery.score.hrv_rmssd_milli).toFixed(1) : null
        updates.rhr = recovery.score.resting_heart_rate
          ? +recovery.score.resting_heart_rate.toFixed(0) : null
      }

      console.log(`Syncing ${dateStr}: sleep=${sleepDuration}h eff=${efficiency}% recovery=${updates.recovery_score}`)

      const { error } = await supabase.from('daily_logs').upsert({
        user_id,
        date: dateStr,
        ...updates,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' })

      if (error) console.error('Upsert error for', dateStr, JSON.stringify(error))
      else synced.push(dateStr)
    }

    // Sync any recovery records without a sleep match
    for (const recovery of recoveryRecords) {
      if (!recovery.score || recovery.score_state !== 'SCORED') continue
      const dateStr = new Date(recovery.created_at).toISOString().split('T')[0]
      if (synced.includes(dateStr)) continue

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

    // Update last synced timestamp
    await supabase.from('whoop_tokens').update({
      last_synced_at: new Date().toISOString(),
    }).eq('user_id', user_id)

    console.log(`Sync complete: ${synced.length} dates synced`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, synced_dates: synced, total: synced.length }),
    }

  } catch (err) {
    console.error('Sync error:', err.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
