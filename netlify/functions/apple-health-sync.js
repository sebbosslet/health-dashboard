const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shortcut-Token',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    console.log('Received body:', JSON.stringify(body))
    const { shortcut_token, date } = body

    // Parse weight - handle float precision from Apple Health
    let weight = null
    if (body.weight !== null && body.weight !== undefined && body.weight !== '') {
      const w = parseFloat(body.weight)
      if (!isNaN(w)) weight = Math.round(w * 10) / 10
    }

    // Parse steps - handle various formats
    let steps = null
    if (body.steps !== null && body.steps !== undefined && body.steps !== '') {
      const s = parseFloat(String(body.steps).replace(/[^0-9.]/g, ''))
      if (!isNaN(s) && s > 0) steps = Math.round(s)
    }

    console.log('Parsed weight:', weight, 'steps:', steps)

    if (!shortcut_token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing shortcut token' }) }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Verify shortcut token and get user
    const { data: settings, error: settingsErr } = await supabase
      .from('user_settings')
      .select('user_id, shortcut_token')
      .eq('shortcut_token', shortcut_token)
      .single()

    if (settingsErr || !settings) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) }
    }

    const userId = settings.user_id
    const dateStr = date || new Date().toISOString().split('T')[0]

    // Build update object with only provided fields
    const updates = { updated_at: new Date().toISOString() }
    if (weight !== undefined && weight !== null) updates.weight = parseFloat(weight)
    if (steps !== undefined && steps !== null) updates.steps = parseInt(steps)

    if (Object.keys(updates).length === 1) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No data provided' }) }
    }

    // Upsert into daily_logs
    const { error } = await supabase.from('daily_logs').upsert({
      user_id: userId,
      date: dateStr,
      ...updates,
    }, { onConflict: 'user_id,date' })

    if (error) {
      console.error('Supabase error:', error)
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save data' }) }
    }

    // Update sync log
    const syncUpdate = { user_id: userId, updated_at: new Date().toISOString() }
    if (weight !== undefined) syncUpdate.last_weight_sync = new Date().toISOString()
    if (steps !== undefined) syncUpdate.last_steps_sync = new Date().toISOString()
    await supabase.from('apple_health_sync').upsert(syncUpdate, { onConflict: 'user_id' })

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        date: dateStr,
        weight: updates.weight || null,
        steps: updates.steps || null,
      }),
    }

  } catch (err) {
    console.error('Handler error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
