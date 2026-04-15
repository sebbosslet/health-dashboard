const { createClient } = require('@supabase/supabase-js')

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

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
    const { code, user_id, redirect_uri } = JSON.parse(event.body || '{}')

    if (!code || !user_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing code or user_id' }) }
    }

    // Exchange code for tokens with WHOOP
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        redirect_uri: redirect_uri || 'https://sebs.health/whoop-callback',
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('WHOOP token error:', tokenRes.status, err)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Token exchange failed', status: tokenRes.status, detail: err }) }
    }

    const tokens = await tokenRes.json()
    console.log('WHOOP tokens received:', JSON.stringify({
      has_access_token: !!tokens.access_token,
      has_refresh_token: !!tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      access_token_preview: tokens.access_token?.slice(0, 20),
    }))
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

    // Get WHOOP user profile
    const profileRes = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = profileRes.ok ? await profileRes.json() : {}

    // Store tokens in Supabase using service key (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { error } = await supabase.from('whoop_tokens').upsert({
      user_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokens.access_token, // fallback if no refresh token
      expires_at: expiresAt,
      whoop_user_id: String(profile.user_id || profile.id || ''),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (error) {
      console.error('Supabase upsert error:', JSON.stringify(error))
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to store tokens', detail: error.message }) }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, whoop_user_id: profile.user_id }) }

  } catch (err) {
    console.error('Handler error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
