const { plaid, admin, requireUser, fail, ok, CORS, missingConfig } = require('./_plaid')

/** Refresh balances and pull new transactions for one item. */
async function syncItem(db, item) {
  const out = { institution: item.institution, accounts: 0, added: 0, modified: 0, removed: 0 }

  // ---- balances ----
  const { accounts } = await plaid('/accounts/balance/get', { access_token: item.access_token })
  const now = new Date().toISOString()
  const rows = accounts.map((a) => ({
    user_id: item.user_id,
    item_id: item.item_id,
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current_balance: a.balances?.current ?? null,
    available_balance: a.balances?.available ?? null,
    limit_amount: a.balances?.limit ?? null,
    balance_as_of: now,
  }))
  if (rows.length) {
    // Don't clobber a mapping the user has chosen.
    for (const r of rows) {
      await db.from('plaid_accounts').upsert(r, { onConflict: 'account_id', ignoreDuplicates: false })
    }
    out.accounts = rows.length
  }

  // ---- transactions ----
  let cursor = item.cursor || undefined
  let more = true
  while (more) {
    const page = await plaid('/transactions/sync', {
      access_token: item.access_token,
      ...(cursor ? { cursor } : {}),
      count: 500,
    })
    const upserts = [...page.added, ...page.modified].map((t) => ({
      user_id: item.user_id,
      account_id: t.account_id,
      transaction_id: t.transaction_id,
      date: t.date,
      amount: t.amount,
      name: t.name,
      merchant_name: t.merchant_name,
      category: t.personal_finance_category?.primary || (t.category || [])[0] || null,
      pending: !!t.pending,
    }))
    if (upserts.length) await db.from('plaid_transactions').upsert(upserts, { onConflict: 'transaction_id' })
    if (page.removed?.length) {
      await db.from('plaid_transactions').delete()
        .in('transaction_id', page.removed.map((r) => r.transaction_id))
    }
    out.added += page.added.length
    out.modified += page.modified.length
    out.removed += page.removed?.length || 0
    cursor = page.next_cursor
    more = page.has_more
  }

  await db.from('plaid_items')
    .update({ cursor, last_synced_at: now, last_error: null, status: 'active' })
    .eq('item_id', item.item_id)

  return out
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  try {
    const bad = missingConfig()
    if (bad) throw Object.assign(new Error(bad), { statusCode: 500 })
    const db = admin()

    // Scheduled runs have no caller; user-triggered runs sync only that user.
    const scheduled = !!event.headers['x-nf-event'] || event.queryStringParameters?.scheduled === '1'
    let query = db.from('plaid_items').select('*').eq('status', 'active')
    if (!scheduled) {
      const user = await requireUser(event)
      query = query.eq('user_id', user.id)
    }

    const { data: items, error } = await query
    if (error) throw error

    const results = []
    for (const item of items || []) {
      try {
        results.push(await syncItem(db, item))
      } catch (err) {
        console.error('sync failed for', item.institution, err.message)
        await db.from('plaid_items')
          .update({ last_error: err.message, status: err.plaid?.error_code === 'ITEM_LOGIN_REQUIRED' ? 'reauth' : 'active' })
          .eq('item_id', item.item_id)
        results.push({ institution: item.institution, error: err.message })
      }
    }
    return ok({ synced: results.length, results })
  } catch (err) {
    return fail(err)
  }
}
