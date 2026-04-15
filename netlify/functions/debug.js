const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const checks = {
    WHOOP_CLIENT_ID: !!process.env.WHOOP_CLIENT_ID,
    WHOOP_CLIENT_SECRET: !!process.env.WHOOP_CLIENT_SECRET,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    WHOOP_CLIENT_ID_value: process.env.WHOOP_CLIENT_ID?.slice(0, 8) + '...',
    SUPABASE_URL_value: process.env.SUPABASE_URL,
  }

  // Test Supabase connection and table existence
  let tableExists = false
  let supabaseError = null
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    const { error } = await supabase.from('whoop_tokens').select('count').limit(1)
    tableExists = !error
    if (error) supabaseError = error.message
  } catch (e) {
    supabaseError = e.message
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ checks, tableExists, supabaseError }),
  }
}
