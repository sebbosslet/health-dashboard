import { gc, admin, requireUser, fail, ok, CORS, missingConfig } from './_gocardless.js'

const num = (v) => (v == null ? null : Number(v))

/** Step 2 and onwards: read accounts, balances and transactions for every linked requisition. */
async function syncRequisition(db, r) {
  const out = { institution: r.institution || r.institution_id, accounts: 0, transactions: 0 }
  const req = await gc(`/requisitions/${r.requisition_id}/`)

  await db.from('gocardless_requisitions')
    .update({ status: req.status, institution_id: req.institution_id })
    .eq('requisition_id', r.requisition_id)

  for (const accountId of req.accounts || []) {
    let meta = {}
    try { meta = await gc(`/accounts/${accountId}/details/`) } catch { /* details are optional */ }
    const balances = await gc(`/accounts/${accountId}/balances/`)
    const pick = (balances.balances || []).find((b) =>
      ['interimAvailable', 'closingBooked', 'expected'].includes(b.balanceType)) || (balances.balances || [])[0]

    await db.from('gocardless_accounts').upsert({
      user_id: r.user_id,
      requisition_id: r.requisition_id,
      account_id: accountId,
      iban: meta.account?.iban || null,
      name: meta.account?.name || meta.account?.ownerName || 'Account',
      currency: pick?.balanceAmount?.currency || meta.account?.currency || 'EUR',
      balance: num(pick?.balanceAmount?.amount),
      balance_as_of: new Date().toISOString(),
    }, { onConflict: 'account_id' })
    out.accounts++

    const tx = await gc(`/accounts/${accountId}/transactions/`)
    const rows = []
    for (const [bucket, pending] of [['booked', false], ['pending', true]]) {
      for (const t of tx.transactions?.[bucket] || []) {
        const id = t.transactionId || t.internalTransactionId
        if (!id) continue
        rows.push({
          user_id: r.user_id,
          account_id: accountId,
          transaction_id: id,
          date: t.bookingDate || t.valueDate || new Date().toISOString().slice(0, 10),
          amount: num(t.transactionAmount?.amount),
          currency: t.transactionAmount?.currency || 'EUR',
          description: t.remittanceInformationUnstructured
            || (t.remittanceInformationUnstructuredArray || []).join(' ')
            || t.additionalInformation || null,
          counterparty: t.creditorName || t.debtorName || null,
          pending,
        })
      }
    }
    if (rows.length) {
      await db.from('gocardless_transactions').upsert(rows, { onConflict: 'transaction_id' })
      out.transactions += rows.length
    }
  }
  return out
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  try {
    const bad = missingConfig()
    if (bad) throw Object.assign(new Error(bad), { statusCode: 500 })
    const db = admin()
    const scheduled = !!event.headers['x-nf-event'] || event.queryStringParameters?.scheduled === '1'

    let q = db.from('gocardless_requisitions').select('*').neq('status', 'expired')
    if (!scheduled) {
      const user = await requireUser(event)
      q = q.eq('user_id', user.id)
    }
    const { data: reqs, error } = await q
    if (error) throw error

    const results = []
    for (const r of reqs || []) {
      try { results.push(await syncRequisition(db, r)) }
      catch (err) {
        console.error('gc sync failed', r.requisition_id, err.message)
        results.push({ institution: r.institution || r.institution_id, error: err.message })
      }
    }
    return ok({ synced: results.length, results })
  } catch (err) {
    return fail(err)
  }
}
