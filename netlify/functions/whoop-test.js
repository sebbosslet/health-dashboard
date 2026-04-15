const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

  try {
    const { user_id } = event.queryStringParameters || {}
    if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Pass ?user_id=...' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    const { data: tokenRow } = await supabase.from('whoop_tokens').select('*').eq('user_id', user_id).single()
    if (!tokenRow) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No token found' }) }

    const token = tokenRow.access_token
    const results = {}

    // Check token status
    results.token = {
      expires_at: tokenRow.expires_at,
      is_expired: new Date(tokenRow.expires_at) < new Date(),
      has_refresh_token: !!tokenRow.refresh_token,
    }

    // Check what dates are in the database
    const { data: dbLogs } = await supabase
      .from('daily_logs')
      .select('date, sleep_duration, recovery_score')
      .eq('user_id', user_id)
      .not('recovery_score', 'is', null)
      .order('date', { ascending: false })
      .limit(20)

    results.db_dates = dbLogs?.map(l => `${l.date} sleep=${l.sleep_duration} rec=${l.recovery_score}`)

    // Test pagination - fetch 3 pages manually
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const startISO = ninetyDaysAgo.toISOString()

    const page1 = await fetch(
      `https://api.prod.whoop.com/developer/v2/activity/sleep?start=${startISO}&limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => r.json())

    const page2 = page1.next_token ? await fetch(
      `https://api.prod.whoop.com/developer/v2/activity/sleep?start=${startISO}&limit=10&next_token=${encodeURIComponent(page1.next_token)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => r.json()) : null

    const page3 = page2?.next_token ? await fetch(
      `https://api.prod.whoop.com/developer/v2/activity/sleep?start=${startISO}&limit=10&next_token=${encodeURIComponent(page2.next_token)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => r.json()) : null

    results.pagination = {
      page1_dates: page1.records?.map(r => r.end?.slice(0,10)),
      page1_next: page1.next_token?.slice(0,20),
      page2_dates: page2?.records?.map(r => r.end?.slice(0,10)),
      page2_next: page2?.next_token?.slice(0,20),
      page3_dates: page3?.records?.map(r => r.end?.slice(0,10)),
      page3_next: page3?.next_token?.slice(0,20),
    }

    return { statusCode: 200, headers, body: JSON.stringify(results, null, 2) }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
