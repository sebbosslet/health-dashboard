import { gc, admin, requireUser, fail, ok, CORS, missingConfig } from './_gocardless.js'

/** Step 1: pick an institution and get a consent URL for the bank's own login. */
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  try {
    const bad = missingConfig()
    if (bad) throw Object.assign(new Error(bad), { statusCode: 500 })
    const user = await requireUser(event)
    const { institution_id, country = 'DE', redirect, list } = JSON.parse(event.body || '{}')

    if (list || !institution_id) {
      const institutions = await gc(`/institutions/?country=${country}`)
      return ok({
        institutions: institutions
          .map((i) => ({ id: i.id, name: i.name, logo: i.logo, days: i.transaction_total_days }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })
    }

    const reference = `${user.id}:${Date.now()}`
    const req = await gc('/requisitions/', {
      method: 'POST',
      body: {
        redirect: redirect || 'https://sebs.health/eur',
        institution_id,
        reference,
        user_language: 'EN',
      },
    })

    await admin().from('gocardless_requisitions').upsert({
      user_id: user.id,
      requisition_id: req.id,
      institution_id,
      status: 'pending',
      reference,
    }, { onConflict: 'requisition_id' })

    return ok({ link: req.link, requisition_id: req.id })
  } catch (err) {
    return fail(err)
  }
}
