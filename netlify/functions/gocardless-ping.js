export const handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ok: true,
    node: process.version,
    has_gocardless_secret_id: !!process.env.GOCARDLESS_SECRET_ID,
    has_gocardless_secret_key: !!process.env.GOCARDLESS_SECRET_KEY,
    has_supabase_url: !!process.env.SUPABASE_URL,
    has_supabase_service_key: !!process.env.SUPABASE_SERVICE_KEY,
  }, null, 2),
})
