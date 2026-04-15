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
    const tokenInfo = {
      expires_at: tokenRow.expires_at,
      is_expired: new Date(tokenRow.expires_at) < new Date(),
      has_refresh_token: !!tokenRow.refresh_token,
      refresh_token_is_same_as_access: tokenRow.refresh_token === tokenRow.access_token,
      last_synced: tokenRow.last_synced_at,
      access_token_preview: token?.slice(0, 20),
    }

    // Test all possible endpoint versions
    const endpoints = [
      'https://api.prod.whoop.com/developer/v1/activity/sleep?limit=2',
      'https://api.prod.whoop.com/developer/v2/activity/sleep?limit=2',
      'https://api.prod.whoop.com/developer/v1/recovery?limit=2',
      'https://api.prod.whoop.com/developer/v2/recovery?limit=2',
      'https://api.prod.whoop.com/developer/v1/cycle?limit=2',
      'https://api.prod.whoop.com/developer/v2/cycle?limit=2',
      'https://api.prod.whoop.com/developer/v1/user/profile/basic',
    ]

    for (const url of endpoints) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const text = await res.text()
      let body
      try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
      results[url] = { status: res.status, records: body?.records?.length, sample: body?.records?.[0] ? Object.keys(body.records[0]) : body }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ tokenInfo, results }, null, 2) }
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
