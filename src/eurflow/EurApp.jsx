import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadEurflow, saveEurflow, seedEurflow } from './store'
import { computeFunding, effectiveFxRate } from './funding'
import { connectBank, syncNow, fetchPlaidAccounts } from '../cashflow/plaid'
import {
  addDays, addMonths, cmp, endOfMonth, monthStartOf, monthName, round2,
  shortDate, todayISO, uid, weekday,
} from '../cashflow/dates'
import '../cashflow/cashflow.css'

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const E = (n) => eur.format(Number(n) || 0)
const U = (n) => usd.format(Number(n) || 0)
const signedE = (n) => (n >= 0 ? `+${E(n)}` : `−${E(Math.abs(n))}`)

const Field = ({ lab, children }) => <label><div className="lab">{lab}</div>{children}</label>

export default function EurApp({ session }) {
  const today = todayISO()
  const [doc, setDoc] = useState(null)
  const [offset, setOffset] = useState(0)
  const [showQuiet, setShowQuiet] = useState(false)
  const [actual, setActual] = useState('')
  const [entry, setEntry] = useState({ date: today, amount: '', description: '', kind: 'oneoff' })
  const [banks, setBanks] = useState({ accounts: [], busy: null, error: null, note: null })
  const timer = useRef(null)

  useEffect(() => {
    let alive = true
    loadEurflow(session.user.id).then((d) => { if (alive) setDoc(d || seedEurflow(today)) })
    return () => { alive = false }
  }, [session.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => saveEurflow(session.user.id, doc), 600)
    return () => clearTimeout(timer.current)
  }, [doc, session.user.id])

  const refreshRate = async () => {
    try {
      const res = await fetch('/.netlify/functions/fx-rate?from=EUR&to=USD')
      const j = await res.json()
      if (j?.rate) setDoc((d) => d && ({ ...d, funding: { ...d.funding, fxLiveRate: j.rate, fxLiveDate: j.date } }))
    } catch { /* keep whatever we last stored */ }
  }
  useEffect(() => { refreshRate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshBanks = async () => {
    try {
      const accounts = await fetchPlaidAccounts(session.user.id, 'EUR')
      setBanks((b) => ({ ...b, accounts, error: null }))
    } catch (e) { setBanks((b) => ({ ...b, error: e.message })) }
  }
  useEffect(() => { refreshBanks() }, [session.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(
    () => doc && computeFunding(doc, today, addDays(today, 366 * 2)),
    [doc, today],
  )

  if (!doc || !plan) return <div className="cf-root" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="eyebrow">Loading…</div></div>

  const f = plan.settings
  const setFunding = (k, v) => setDoc((d) => ({ ...d, funding: { ...d.funding, [k]: v } }))
  const expected = plan.days.find((d) => d.date === today)?.balance ?? doc.anchor.balance
  const delta = actual === '' || isNaN(+actual) ? null : +actual - expected

  const mStart = monthStartOf(addMonths(today, offset))
  const mEnd = endOfMonth(mStart)
  const monthDays = plan.days.filter((d) => cmp(d.date, mStart) >= 0 && cmp(d.date, mEnd) <= 0)
  const inflow = round2(monthDays.flatMap((d) => d.events).filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0))
  const outflow = round2(monthDays.flatMap((d) => d.events).filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0))
  const closing = monthDays.length ? monthDays[monthDays.length - 1].balance : 0

  const next12 = plan.transfers.filter((t) => cmp(t.date, addDays(today, 366)) <= 0)
  const yearEur = round2(next12.reduce((s, t) => s + t.amountEur, 0))
  const yearUsd = round2(next12.reduce((s, t) => s + t.amountUsd, 0))

  const addEntry = () => {
    if (!entry.amount) return
    setDoc((d) => ({ ...d, transactions: [...(d.transactions || []), {
      id: uid(), date: entry.date,
      amount: entry.kind === 'in' ? Math.abs(+entry.amount) : -Math.abs(+entry.amount),
      description: entry.description || (entry.kind === 'in' ? 'Deposit' : 'Card spending'),
      type: 'oneoff', status: 'scheduled',
    }] }))
    setEntry({ ...entry, amount: '', description: '' })
  }

  const runBank = async (label, fn) => {
    setBanks((b) => ({ ...b, busy: label, error: null, note: null }))
    try {
      const r = await fn()
      if (r?.synced != null) setBanks((b) => ({ ...b, note: `Synced ${r.synced} connection${r.synced === 1 ? '' : 's'}` }))
      if (r?.institution) setBanks((b) => ({ ...b, note: `${r.institution} connected` }))
    } catch (e) { setBanks((b) => ({ ...b, error: e.message })) }
    finally { setBanks((b) => ({ ...b, busy: null })); refreshBanks() }
  }

  return (
    <div className="cf-root">
      <nav className="side">
        <Link className="wordmark" to="/" title="All apps">sebs<span>.</span>cashflow</Link>
        <Link className="navbtn" to="/cashflow">← USD</Link>
        <div className="navbtn on">EUR</div>
        <div style={{ marginTop: 'auto', padding: '0 8px' }}>
          <div className="when">{shortDate(today)} {today.slice(0, 4)}</div>
        </div>
      </nav>

      <main className="main">
        <div className="screenhead">
          <h1>Euro account</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="ghost" disabled={offset <= 0} onClick={() => setOffset(offset - 1)}>‹</button>
            <span className="num" style={{ fontSize: 15, minWidth: 104, textAlign: 'center' }}>{monthName(mStart)}</span>
            <button className="ghost" onClick={() => setOffset(offset + 1)}>›</button>
          </div>
        </div>

        <div className="statgrid">
          <section className="panel">
            <div className="eyebrow">Expected today</div>
            <div className="bignum">{E(expected)}</div>
            <div className="when">floor {E(f.minBalance)}</div>
          </section>
          <section className="panel">
            <div className="eyebrow">Actual — from N26</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input type="number" placeholder={Number(expected).toFixed(2)} value={actual} onChange={(e) => setActual(e.target.value)} />
              <button className="primary" disabled={delta === null}
                onClick={() => { setDoc((d) => ({ ...d, anchor: { date: today, balance: +actual } })); setActual('') }}>Anchor</button>
            </div>
            <div className="when" style={{ marginTop: 5 }}>last anchored {shortDate(doc.anchor.date)}</div>
          </section>
          <section className="panel">
            <div className="eyebrow">Difference</div>
            <div className="bignum" style={{ color: delta !== null && Math.abs(delta) >= 0.005 ? 'var(--red)' : 'var(--green)' }}>
              {delta === null ? '—' : Math.abs(delta) < 0.005 ? E(0) : signedE(delta)}
            </div>
            <div className="when">{delta === null ? 'enter a balance to compare' : Math.abs(delta) < 0.005 ? 'matches' : 'check the month below'}</div>
          </section>
        </div>

        {/* ---- funding bridge ---- */}
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div>
              <span className="gname">Funding from USD</span>
              <div className="when" style={{ marginTop: 1 }}>
                no income lands here — top-ups are scheduled automatically, at most one a month
              </div>
            </div>
            <span className="amt" style={{ fontWeight: 600 }}>{E(yearEur)}<span style={{ color: 'var(--faint)', fontWeight: 400 }}> · {U(yearUsd)}/yr</span></span>
          </div>
          <div className="formgrid">
            <Field lab="Never below €"><input type="number" value={f.minBalance} onChange={(e) => setFunding('minBalance', +e.target.value || 0)} /></Field>
            <Field lab="Transfer on day"><input type="number" min="1" max="28" value={f.fundingDay} onChange={(e) => setFunding('fundingDay', +e.target.value || 1)} /></Field>
            <Field lab="Round up to €"><input type="number" value={f.roundTo} onChange={(e) => setFunding('roundTo', +e.target.value || 0)} /></Field>
            <Field lab="Provider spread %"><input type="number" step="0.1" value={f.fxSpreadPct ?? 0.5} onChange={(e) => setFunding('fxSpreadPct', +e.target.value || 0)} /></Field>
          </div>
          <div className="ratebar">
            <div>
              <div className="lab">Exchange rate</div>
              <div className="when" style={{ marginTop: 2 }}>
                {f.fxMode === 'manual'
                  ? 'fixed rate you set'
                  : f.fxLiveDate
                    ? `ECB reference ${Number(f.fxLiveRate).toFixed(4)} · ${f.fxLiveDate}`
                    : 'fetching reference rate…'}
                {f.fxSpreadPct > 0 && f.fxMode !== 'manual' ? ` · +${f.fxSpreadPct}% spread` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {f.fxMode === 'manual' && (
                <input style={{ width: 100 }} type="number" step="0.0001"
                  value={f.fxManual ?? f.fxRate} onChange={(e) => setFunding('fxManual', +e.target.value || 1)} />
              )}
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 18 }}>{plan.rate.toFixed(4)}</div>
                <div className="when">used for planning</div>
              </div>
              <button className="ghost" onClick={() => setFunding('fxMode', f.fxMode === 'manual' ? 'live' : 'manual')}>
                {f.fxMode === 'manual' ? 'Use live' : 'Set manually'}
              </button>
              {f.fxMode !== 'manual' && <button className="ghost" onClick={refreshRate}>Refresh</button>}
            </div>
          </div>

          <div className="eyebrow" style={{ marginTop: 14, marginBottom: 4 }}>Next transfers</div>
          {next12.length === 0 && <div style={{ color: 'var(--faint)', fontSize: 13 }}>
            The balance stays above {E(f.minBalance)} for the next year without any funding.
          </div>}
          {next12.slice(0, 12).map((t) => (
            <div className="detrow" key={t.date} style={{ gridTemplateColumns: '64px 1fr auto auto' }}>
              <span className="dt">{shortDate(t.date)}</span>
              <span className="dn">would have dipped to {E(t.reason)}</span>
              <span className="amt da" style={{ minWidth: 90 }}>{E(t.amountEur)}</span>
              <span className="amt da" style={{ minWidth: 90, color: 'var(--mut)' }}>{U(t.amountUsd)}</span>
            </div>
          ))}
          <div className="legend">
            Each transfer is sized to hold the floor until the next one, rounded up to the nearest {E(f.roundTo)}.
            Dollar amounts are a forecast at today’s rate — the real cost lands when you transfer, and any
            difference shows up in the normal USD reconciliation rather than being hidden here.
          </div>
        </section>

        {/* ---- month ---- */}
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div>
              <span className="gname">{monthName(mStart)}</span>
              <div className="when" style={{ marginTop: 1 }}>
                in {E(inflow)} · out {E(outflow)} · closing {E(closing)}
              </div>
            </div>
            <label style={{ fontSize: 12.5, color: 'var(--mut)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} style={{ width: 'auto' }} />
              empty days
            </label>
          </div>
          <div className="yearhead dgrid"><span>Day</span><span>Activity</span><span>In</span><span>Out</span><span>Balance</span></div>
          {monthDays.map((d) => {
            const quiet = d.events.length === 0
            if (quiet && !showQuiet) return null
            const isToday = d.date === today
            const dIn = round2(d.events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0))
            const dOut = round2(d.events.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0))
            return (
              <div className={`yearrow dgrid${isToday ? ' todayrow' : ''}${quiet ? ' empty' : ''}${cmp(d.date, today) < 0 && !isToday ? ' pastrow' : ''}`} key={d.date} style={{ cursor: 'default' }}>
                <span className="mname">{+d.date.slice(8, 10)}<span className="wd"> {weekday(d.date)}</span></span>
                <span className="dact">
                  {quiet ? <span style={{ color: 'var(--faint)' }}>—</span> : d.events.map((e) => e.description).join(' · ')}
                  {isToday && <span className="tag good">today</span>}
                </span>
                <span className="num pos">{dIn > 0 ? E(dIn) : ''}</span>
                <span className="num">{dOut > 0 ? E(dOut) : ''}</span>
                <span className="num" style={{ color: d.belowFloor ? 'var(--red)' : quiet ? 'var(--faint)' : 'var(--ink)' }}>{E(d.balance)}</span>
              </div>
            )
          })}
        </section>

        {/* ---- fixed payments + one-offs ---- */}
        <div className="grid2">
          <section className="panel">
            <div className="grouphead">
              <div><span className="gname">Fixed payments</span><div className="when" style={{ marginTop: 1 }}>monthly direct debits</div></div>
              <button onClick={() => setDoc((d) => ({ ...d, rules: [...d.rules, { id: uid(), name: '', amount: 0, dueDay: 1, active: true, startDate: today, endDate: '' }] }))}>+ Add</button>
            </div>
            {doc.rules.map((r) => (
              <div className="asmrow" key={r.id}>
                <input style={{ flex: '2 1 120px' }} value={r.name} placeholder="Name"
                  onChange={(e) => setDoc((d) => ({ ...d, rules: d.rules.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) }))} />
                <input style={{ flex: '0 1 88px' }} type="number" value={r.amount}
                  onChange={(e) => setDoc((d) => ({ ...d, rules: d.rules.map((x) => x.id === r.id ? { ...x, amount: +e.target.value || 0 } : x) }))} />
                <span className="when">day</span>
                <input style={{ flex: '0 1 60px' }} type="number" min="1" max="28" value={r.dueDay}
                  onChange={(e) => setDoc((d) => ({ ...d, rules: d.rules.map((x) => x.id === r.id ? { ...x, dueDay: +e.target.value || 1 } : x) }))} />
                <button className="ghost" onClick={() => setDoc((d) => ({ ...d, rules: d.rules.map((x) => x.id === r.id ? { ...x, active: !x.active } : x) }))}>{r.active ? 'On' : 'Off'}</button>
                <button className="danger-btn" onClick={() => setDoc((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }))}>✕</button>
              </div>
            ))}
            <div className="legend">≈ {E(doc.rules.filter((r) => r.active).reduce((s, r) => s + Number(r.amount), 0))} a month</div>
          </section>

          <section className="panel">
            <div className="grouphead">
              <div><span className="gname">One-offs</span><div className="when" style={{ marginTop: 1 }}>card spending when you visit, transfers, anything unusual</div></div>
            </div>
            <div className="formgrid" style={{ marginTop: 8 }}>
              <Field lab="Type"><select value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}>
                <option value="oneoff">Spending</option><option value="in">Money in</option>
              </select></Field>
              <Field lab="Date"><input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field>
              <Field lab="Amount €"><input type="number" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></Field>
              <Field lab="Description"><input value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /></Field>
              <div style={{ display: 'flex', alignItems: 'end' }}><button className="primary" disabled={!entry.amount} onClick={addEntry}>Add</button></div>
            </div>
            {(doc.transactions || []).slice().sort((a, b) => cmp(b.date, a.date)).slice(0, 8).map((t) => (
              <div className="detrow" key={t.id}>
                <span className="dt">{shortDate(t.date)}</span>
                <span className="dn">{t.description}</span>
                <span className={`amt da ${t.amount > 0 ? 'pos' : ''}`}>{signedE(t.amount)}</span>
                <button className="danger-btn" onClick={() => setDoc((d) => ({ ...d, transactions: d.transactions.filter((x) => x.id !== t.id) }))}>✕</button>
              </div>
            ))}
          </section>
        </div>

        {/* ---- bank ---- */}
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div>
              <span className="gname">German bank</span>
              <div className="when" style={{ marginTop: 1 }}>
                connected through the same Plaid account as your dollar side · consent renews every 90 days
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={banks.busy === 'sync' || !banks.accounts.length} onClick={() => runBank('sync', syncNow)}>
                {banks.busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="primary" disabled={banks.busy === 'connect'}
                onClick={() => runBank('connect', () => connectBank({ countryCodes: ['DE'] }))}>
                {banks.busy === 'connect' ? 'Opening…' : '+ Connect N26'}
              </button>
            </div>
          </div>
          {banks.error && <div className="notice bad" style={{ marginTop: 12 }}>
            <span className="danger" style={{ fontWeight: 600 }}>{banks.error}</span>
          </div>}
          {banks.note && <div className="notice" style={{ marginTop: 12 }}>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>{banks.note}</span>
          </div>}

          {banks.accounts.length === 0 && !banks.error && (
            <div style={{ color: 'var(--faint)', fontSize: 13.5, padding: '14px 0' }}>
              No euro account connected. Connecting N26 replaces typing the balance each time —
              everything below keeps working manually either way.
            </div>
          )}

          {banks.accounts.map((a) => (
            <div className="row" key={a.account_id}>
              <div style={{ flex: 1 }}>
                <span>{a.name || 'Account'}{a.mask ? ` ····${a.mask}` : ''}</span>
                <span className="tag">{a.subtype || a.type}</span>
                <div className="when">{E(a.current_balance)}</div>
              </div>
              <button className="ghost" onClick={() => {
                setDoc((d) => ({ ...d, anchor: { date: today, balance: Number(a.current_balance) || 0 } }))
                setBanks((b) => ({ ...b, note: 'Balance applied' }))
              }}>Use balance</button>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
