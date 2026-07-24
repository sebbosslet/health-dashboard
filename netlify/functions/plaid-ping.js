/** Diagnostic: confirms the function runtime works and the config is visible.
 *  Open /.netlify/functions/plaid-ping in a browser. Reveals no secret values. */
export const handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ok: true,
    node: process.version,
    plaid_env: process.env.PLAID_ENV || 'unset',
    has_plaid_client_id: !!process.env.PLAID_CLIENT_ID,
    has_plaid_secret: !!process.env.PLAID_SECRET,
    has_supabase_url: !!process.env.SUPABASE_URL,
    has_supabase_service_key: !!process.env.SUPABASE_SERVICE_KEY,
  }, null, 2),
})
