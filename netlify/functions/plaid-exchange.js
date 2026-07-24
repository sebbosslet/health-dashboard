import { plaid, admin, requireUser, fail, ok, CORS, missingConfig } from './_plaid.js'

/** Guess how a Plaid account maps onto the cashflow model. The user can override. */
function suggestMapping(acct) {
  if (acct.type === 'depository' && ['checking'].includes(acct.subtype)) return 'checking'
  if (acct.type === 'credit') return 'card'
  if (acct.type === 'investment' || ['hsa', 'savings'].includes(acct.subtype)) return 'asset'
  return 'ignore'
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  try {
    const bad = missingConfig()
    if (bad) throw Object.assign(new Error(bad), { statusCode: 500 })
    const user = await requireUser(event)
    const { public_token, institution } = JSON.parse(event.body || '{}')
    if (!public_token) throw Object.assign(new Error('Missing public_token'), { statusCode: 400 })

    const { access_token, item_id } = await plaid('/item/public_token/exchange', { public_token })
    const db = admin()

    await db.from('plaid_items').upsert({
      user_id: user.id,
      item_id,
      access_token,
      institution_id: institution?.institution_id || null,
      institution: institution?.name || null,
      status: 'active',
    }, { onConflict: 'item_id' })

    const { accounts } = await plaid('/accounts/get', { access_token })
    const rows = accounts.map((a) => ({
      user_id: user.id,
      item_id,
      account_id: a.account_id,
      name: a.name,
      official_name: a.official_name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current_balance: a.balances?.current ?? null,
      available_balance: a.balances?.available ?? null,
      limit_amount: a.balances?.limit ?? null,
      mapping_kind: suggestMapping(a),
      balance_as_of: new Date().toISOString(),
    }))
    if (rows.length) await db.from('plaid_accounts').upsert(rows, { onConflict: 'account_id' })

    return ok({ item_id, accounts: rows.length, institution: institution?.name || null })
  } catch (err) {
    return fail(err)
  }
}
