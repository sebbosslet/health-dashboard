import { useEffect, useState } from 'react'
import { connectBank, fetchPlaidAccounts, saveMapping, syncNow, recentTransactions } from './plaid'
import { setCardBalance, setAnchor, setAssetBalance } from './ops'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (n) => (n == null ? '—' : usd.format(n))
const ago = (iso) => {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

export default function BanksTab({ data, setData, today, session }) {
  const [accounts, setAccounts] = useState([])
  const [txs, setTxs] = useState([])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)

  const refresh = async () => {
    try {
      const [a, t] = await Promise.all([
        fetchPlaidAccounts(session.user.id),
        recentTransactions(session.user.id, 12),
      ])
      setAccounts(a); setTxs(t); setError(null)
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { refresh() }, [session.user.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label, fn) => {
    setBusy(label); setError(null); setNote(null)
    try { const r = await fn(); if (r?.note) setNote(r.note) }
    catch (e) { setError(e.message) }
    finally { setBusy(null); refresh() }
  }

  const options = [
    { value: 'checking', label: 'Checking account' },
    ...data.cards.map((c) => ({ value: `card:${c.id}`, label: c.name })),
    ...(data.assets || []).map((a) => ({ value: `asset:${a.id}`, label: a.name })),
    { value: 'ignore', label: "Don't use" },
  ]

  const valueFor = (a) => (a.mapping_kind === 'card' || a.mapping_kind === 'asset')
    ? `${a.mapping_kind}:${a.mapping_ref || ''}` : (a.mapping_kind || 'ignore')

  const changeMapping = (a, value) => {
    const [kind, ref] = value.includes(':') ? value.split(':') : [value, null]
    setAccounts((prev) => prev.map((x) => x.account_id === a.account_id
      ? { ...x, mapping_kind: kind, mapping_ref: ref } : x))
    run('map', () => saveMapping(a.account_id, kind, ref))
  }

  const applyBalance = (a) => {
    const bal = Number(a.current_balance)
    if (!Number.isFinite(bal)) return
    if (a.mapping_kind === 'checking') setData((d) => setAnchor(d, bal, today))
    else if (a.mapping_kind === 'card') setData((d) => setCardBalance(d, a.mapping_ref, bal, today))
    else if (a.mapping_kind === 'asset') setData((d) => setAssetBalance(d, a.mapping_ref, bal, today))
    setNote(`${a.name} applied at ${money(bal)}`)
  }

  const usable = accounts.filter((a) => a.mapping_kind && a.mapping_kind !== 'ignore')

  return (
    <>
      <div className="grouphead">
        <div>
          <span className="gname">Connected banks</span>
          <div className="when" style={{ marginTop: 1 }}>
            balances and transactions pulled from your accounts, refreshed daily
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy === 'sync' || !accounts.length} onClick={() => run('sync', syncNow)}>
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="primary" disabled={busy === 'connect'} onClick={() => run('connect', connectBank)}>
            {busy === 'connect' ? 'Opening…' : '+ Connect a bank'}
          </button>
        </div>
      </div>

      {error && <div className="notice bad" style={{ marginTop: 12 }}>
        <span className="danger" style={{ fontWeight: 600 }}>{error}</span>
      </div>}
      {note && <div className="notice" style={{ marginTop: 12 }}>
        <span style={{ color: 'var(--green)', fontWeight: 600 }}>{note}</span>
      </div>}

      {accounts.length === 0 && !error && (
        <div style={{ color: 'var(--faint)', fontSize: 13.5, padding: '14px 0' }}>
          No banks connected yet. Connecting one lets the app read your balances instead of
          asking you to type them, and match real transactions against your fixed charges.
        </div>
      )}

      {accounts.map((a) => (
        <div className="row" key={a.account_id}>
          <div style={{ flex: 1 }}>
            <span>{a.name}{a.mask ? ` ····${a.mask}` : ''}</span>
            <span className="tag">{a.subtype || a.type}</span>
            <div className="when">
              {money(a.current_balance)} · updated {ago(a.balance_as_of)}
            </div>
          </div>
          <select
            style={{ width: 190 }}
            value={valueFor(a)}
            onChange={(e) => changeMapping(a, e.target.value)}
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            className="ghost"
            disabled={!a.mapping_kind || a.mapping_kind === 'ignore'}
            onClick={() => applyBalance(a)}
            title="Copy this balance into the forecast"
          >
            Use balance
          </button>
        </div>
      ))}

      {usable.length > 0 && (
        <div className="legend" style={{ marginTop: 10 }}>
          “Use balance” writes the live figure into the forecast — as today’s anchor for checking,
          or as the current balance for a card or asset.
        </div>
      )}

      {txs.length > 0 && (
        <>
          <div className="grouphead" style={{ marginTop: 24 }}>
            <div><span className="gname">Latest transactions</span>
              <div className="when" style={{ marginTop: 1 }}>most recent {txs.length}, newest first</div></div>
          </div>
          {txs.map((t) => (
            <div className="detrow" key={t.transaction_id} style={{ opacity: t.pending ? 0.6 : 1 }}>
              <span className="dt">{t.date.slice(5)}</span>
              <span className="dn">{t.merchant_name || t.name}{t.pending && <span className="tag">pending</span>}</span>
              <span className="tag">{t.category || '—'}</span>
              <span className="amt da">{money(Math.abs(Number(t.amount)))}</span>
            </div>
          ))}
        </>
      )}
    </>
  )
}
