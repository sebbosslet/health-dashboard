import { plaid, requireUser, fail, ok, CORS, missingConfig } from './_plaid.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  try {
    const bad = missingConfig()
    if (bad) throw Object.assign(new Error(bad), { statusCode: 500 })
    const user = await requireUser(event)
    const { access_token, country_codes } = JSON.parse(event.body || '{}')

    const res = await plaid('/link/token/create', {
      user: { client_user_id: user.id },
      client_name: 'sebs.cashflow',
      language: 'en',
      country_codes: Array.isArray(country_codes) && country_codes.length ? country_codes : ['US'],
      // Re-auth flow: pass an access_token to repair a broken connection
      ...(access_token ? { access_token } : { products: ['transactions'] }),
    })
    return ok({ link_token: res.link_token, expiration: res.expiration })
  } catch (err) {
    return fail(err)
  }
}
