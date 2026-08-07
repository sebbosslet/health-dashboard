import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { projectTax, DOC_TYPES } from './engine'
import { extractPayslip } from './extract'
import { loadTaxState, saveTaxState, uploadTaxDoc, listTaxDocs, signedUrl, deleteTaxDoc } from './store'
import '../cashflow/cashflow.css' // shared design tokens only — no data crosses between apps

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const M = (n) => usd.format(Number(n) || 0)
const signed = (n) => (n >= 0 ? `+${M(n)}` : `−${M(Math.abs(n))}`)
const Field = ({ lab, children }) => <label><div className="lab">{lab}</div>{children}</label>

export default function TaxApp({ session, advisor = false }) {
  const year = new Date().getFullYear()
  const [doc, setDoc] = useState(null)
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const fileRef = useRef(null)
  const payslipRef = useRef(null)
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState(null)
  const [form, setForm] = useState({ category: 'llc', doc_type: 'receipt', year_end: false, note: '' })

  useEffect(() => {
    let alive = true
    if (!advisor) {
      loadTaxState(session.user.id).then((d) => { if (alive) setDoc(d || {
        grossPerCheck: '', fedPerCheck: '', statePerCheck: '', pretaxPerCheck: '',
        periodsPerYear: 26, llcNetIncome: 0,
      }) })
    } else { setDoc({}) }
    refreshDocs(alive)
    return () => { alive = false }
  }, [session.user.id]) // eslint-disable-line

  const refreshDocs = async (alive = true) => {
    const rows = await listTaxDocs(advisor ? null : session.user.id, year)
    if (alive) setDocs(rows)
  }

  useEffect(() => {
    if (advisor || !doc) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => saveTaxState(session.user.id, doc), 500)
    return () => clearTimeout(timer.current)
  }, [doc, advisor, session.user.id])

  const hasPay = doc && Number(doc.grossPerCheck) > 0
  const projection = useMemo(() => {
    if (advisor || !hasPay) return null
    return projectTax({
      periodsPerYear: Number(doc.periodsPerYear) || 26,
      grossPerCheck: Number(doc.grossPerCheck) || 0,
      fedPerCheck: Number(doc.fedPerCheck) || 0,
      statePerCheck: Number(doc.statePerCheck) || 0,
      pretaxPerCheck: Number(doc.pretaxPerCheck) || 0,
      llcNetIncome: Number(doc.llcNetIncome) || 0,
    })
  }, [doc, advisor, hasPay])

  const onReadPayslip = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setReading(true); setReadNote(null); setError(null)
    try {
      const f = await extractPayslip(file)
      setDoc((d) => ({
        ...d,
        grossPerCheck: f.grossPerCheck ?? d.grossPerCheck,
        fedPerCheck: f.fedPerCheck ?? d.fedPerCheck,
        statePerCheck: f.statePerCheck ?? d.statePerCheck,
        pretaxPerCheck: f.pretaxPerCheck ?? d.pretaxPerCheck,
        periodsPerYear: f.periodsPerYear || d.periodsPerYear || 26,
      }))
      setReadNote('Figures read from the payslip — check them below, then they feed the projection.')
      // also file the payslip itself, tagged employment
      try { await uploadTaxDoc(session.user.id, file, { category: 'employment', doc_type: 'payslip', year_end: false, tax_year: year, note: 'auto-read' }); refreshDocs() } catch { /* keep the figures even if storing fails */ }
    } catch (err) { setError(err.message) }
    finally { setReading(false); if (payslipRef.current) payslipRef.current.value = '' }
  }

  const onUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try {
      const dt = DOC_TYPES.find((t) => t.id === form.doc_type)
      await uploadTaxDoc(session.user.id, file, {
        ...form, year_end: form.year_end || !!dt?.yearEnd, tax_year: year,
      })
      await refreshDocs()
    } catch (err) { setError(err.message) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const open = async (d) => { const u = await signedUrl(d.storage_path); if (u) window.open(u, '_blank') }
  const remove = async (d) => { if (confirm(`Delete ${d.file_name}?`)) { await deleteTaxDoc(d); refreshDocs() } }

  const llcDocs = docs.filter((d) => d.category === 'llc')
  const empDocs = docs.filter((d) => d.category === 'employment')

  return (
    <div className="cf-root">
      <nav className="side">
        <Link className="wordmark" to="/" title="All apps">sebs<span>.</span>tax</Link>
        {!advisor && <Link className="navbtn" to="/">← apps</Link>}
        <div className="navbtn on">{advisor ? 'Advisor view' : `Tax ${year}`}</div>
        <div style={{ marginTop: 'auto', padding: '0 8px' }}>
          <button className="ghost" style={{ fontSize: 12 }}
            onClick={() => import('../lib/supabase').then((m) => m.supabase.auth.signOut())}>Sign out</button>
        </div>
      </nav>

      <main className="main">
        <div className="screenhead">
          <h1>{advisor ? `LLC documents · ${year}` : `Tax projection · ${year}`}</h1>
        </div>

        {advisor && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <span style={{ color: 'var(--mut)' }}>
              You're seeing LLC receipts and year-end tax documents only. Ongoing payslips are not shared.
            </span>
          </div>
        )}

        {/* ---------- OWNER: projection ---------- */}
        {!advisor && (
          <>
            <section className="panel" style={{ marginBottom: 16 }}>
              <div className="grouphead">
                <div><span className="gname">Your latest paycheck</span><div className="when" style={{ marginTop: 1 }}>upload a payslip to read the figures automatically, or type them in — the projection assumes it continues to year-end</div></div>
                <button className="primary" disabled={reading} onClick={() => payslipRef.current?.click()}>
                  {reading ? 'Reading…' : 'Read from payslip'}
                </button>
                <input ref={payslipRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" onChange={onReadPayslip} />
              </div>
              {readNote && <div className="notice" style={{ marginTop: 10, marginBottom: 2 }}><span style={{ color: 'var(--green)', fontWeight: 600 }}>{readNote}</span></div>}
              <div className="formgrid" style={{ marginTop: 8 }}>
                <Field lab="Gross per check"><input type="number" value={doc?.grossPerCheck ?? ''} onChange={(e) => setDoc((d) => ({ ...d, grossPerCheck: e.target.value }))} /></Field>
                <Field lab="Federal withheld / check"><input type="number" value={doc?.fedPerCheck ?? ''} onChange={(e) => setDoc((d) => ({ ...d, fedPerCheck: e.target.value }))} /></Field>
                <Field lab="State withheld / check"><input type="number" value={doc?.statePerCheck ?? ''} onChange={(e) => setDoc((d) => ({ ...d, statePerCheck: e.target.value }))} /></Field>
                <Field lab="Pre-tax / check (401k, HSA…)"><input type="number" value={doc?.pretaxPerCheck ?? ''} onChange={(e) => setDoc((d) => ({ ...d, pretaxPerCheck: e.target.value }))} /></Field>
                <Field lab="Paychecks per year"><input type="number" value={doc?.periodsPerYear ?? 26} onChange={(e) => setDoc((d) => ({ ...d, periodsPerYear: e.target.value }))} /></Field>
              </div>
              {!hasPay && <div className="when" style={{ marginTop: 8 }}>Enter your gross to see the projection.</div>}
            </section>

            {projection && (
              <>
                <div className="statgrid">
                  <section className="panel">
                    <div className="eyebrow">Projected {projection.owes ? 'balance owed' : 'refund'}</div>
                    <div className="bignum" style={{ color: projection.owes ? 'var(--red)' : 'var(--green)' }}>
                      {projection.owes ? M(Math.abs(projection.totalRefund)) : M(projection.totalRefund)}
                    </div>
                    <div className="when">if this paycheck continues to year-end</div>
                  </section>
                  <section className="panel">
                    <div className="eyebrow">Total withheld</div>
                    <div className="bignum">{M(projection.totalWithheld)}</div>
                    <div className="when">federal + state, annualised</div>
                  </section>
                  <section className="panel">
                    <div className="eyebrow">Total liability</div>
                    <div className="bignum">{M(projection.totalLiability)}</div>
                    <div className="when">what you actually owe</div>
                  </section>
                </div>

                <section className="panel" style={{ marginTop: 16 }}>
                  <div className="grouphead">
                    <div><span className="gname">LLC net income</span><div className="when" style={{ marginTop: 1 }}>Schedule C — a loss lowers your taxable income and increases the refund</div></div>
                  </div>
                  <div className="formgrid" style={{ marginTop: 8 }}>
                    <Field lab="Projected annual net ($, negative for a loss)">
                      <input type="number" value={doc?.llcNetIncome ?? 0}
                        onChange={(e) => setDoc((d) => ({ ...d, llcNetIncome: e.target.value }))} />
                    </Field>
                  </div>
                  {Number(doc?.llcNetIncome) < 0 && (
                    <div className="when" style={{ marginTop: 8, color: 'var(--green)' }}>
                      The {M(Math.abs(Number(doc.llcNetIncome)))} loss offsets your W-2 income — reflected in the tables below.
                    </div>
                  )}
                </section>

                <TaxTable projection={projection} llcNet={Number(doc?.llcNetIncome) || 0} />

                <div className="legend" style={{ marginTop: 12 }}>
                  Estimate only, not tax advice. 2025 brackets, single filer, Virginia, standard deduction.
                  Ignores credits, itemised deductions, QBI, and other income. The employment side annualises
                  your current paycheck; the LLC side is your projected Schedule C net.
                </div>
              </>
            )}
          </>
        )}

        {/* ---------- documents ---------- */}
        {!advisor && (
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="grouphead">
              <div><span className="gname">Upload a document</span><div className="when" style={{ marginTop: 1 }}>payslips, W-2, 1095-C, LLC receipts, 1099s</div></div>
            </div>
            <div className="formgrid" style={{ marginTop: 8 }}>
              <Field lab="Goes towards">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="llc">LLC</option>
                  <option value="employment">Full-time employment</option>
                </select>
              </Field>
              <Field lab="Type">
                <select value={form.doc_type} onChange={(e) => {
                  const dt = DOC_TYPES.find((t) => t.id === e.target.value)
                  setForm({ ...form, doc_type: e.target.value, category: dt?.cat || form.category, year_end: !!dt?.yearEnd })
                }}>
                  {DOC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              <Field lab="Note (optional)"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--mut)', alignSelf: 'end' }}>
                <input type="checkbox" checked={form.year_end} onChange={(e) => setForm({ ...form, year_end: e.target.checked })} style={{ width: 'auto' }} />
                year-end doc (advisor can see)
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : 'Choose file'}</button>
                <input ref={fileRef} type="file" hidden onChange={onUpload}
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.webp" />
              </div>
            </div>
            {error && <div className="notice bad" style={{ marginTop: 10 }}><span className="danger">{error}</span></div>}
          </section>
        )}

        <DocList title={advisor ? 'LLC & year-end documents' : 'LLC documents'} docs={llcDocs} onOpen={open} onRemove={advisor ? null : remove} />
        {!advisor && <DocList title="Employment documents" docs={empDocs} onOpen={open} onRemove={remove} />}
      </main>
    </div>
  )
}

function TaxTable({ projection: p, llcNet }) {
  const rows = [
    { label: 'Gross income (annualised)', emp: p.annualGross, llc: llcNet, comb: p.annualGross + llcNet },
    { label: 'Pre-tax deductions', emp: -p.annualPretax, llc: 0, comb: -p.annualPretax },
    { label: 'Half of SE tax deduction', emp: 0, llc: -p.halfSE, comb: -p.halfSE },
    { label: 'Adjusted gross income', emp: p.w2Taxable, llc: llcNet - p.halfSE, comb: p.agi, strong: true },
  ]
  const liab = [
    { label: 'Federal income tax', emp: null, llc: null, comb: p.fed.incomeTax },
    { label: 'Self-employment tax', emp: 0, llc: p.seTax, comb: p.seTax },
    { label: 'State income tax (VA)', emp: null, llc: null, comb: p.state.liability },
    { label: 'Total tax liability', emp: null, llc: null, comb: p.totalLiability, strong: true },
  ]
  const settle = [
    { label: 'Federal withheld', comb: p.fed.withheld },
    { label: 'State withheld', comb: p.state.withheld },
    { label: 'Total withheld', comb: p.totalWithheld, strong: true },
    { label: p.owes ? 'Balance owed' : 'Refund', comb: Math.abs(p.totalRefund), accent: p.owes ? 'red' : 'green', strong: true },
  ]
  const Cell = ({ v }) => <span className="num">{v == null ? '—' : M(v)}</span>
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="grouphead"><div><span className="gname">Breakdown</span><div className="when" style={{ marginTop: 1 }}>employment · LLC · combined</div></div></div>
      <div className="taxhead"><span>Line</span><span>Employment</span><span>LLC</span><span>Combined</span></div>
      {rows.map((r) => (
        <div className={`taxrow${r.strong ? ' strong' : ''}`} key={r.label}>
          <span className="tl">{r.label}</span><Cell v={r.emp} /><Cell v={r.llc} /><Cell v={r.comb} />
        </div>
      ))}
      <div className="taxsub">Tax liability</div>
      {liab.map((r) => (
        <div className={`taxrow${r.strong ? ' strong' : ''}`} key={r.label}>
          <span className="tl">{r.label}</span><Cell v={r.emp} /><Cell v={r.llc} /><Cell v={r.comb} />
        </div>
      ))}
      <div className="taxsub">Settlement</div>
      {settle.map((r) => (
        <div className={`taxrow${r.strong ? ' strong' : ''}`} key={r.label}>
          <span className="tl">{r.label}</span><span /><span />
          <span className="num" style={{ color: r.accent === 'red' ? 'var(--red)' : r.accent === 'green' ? 'var(--green)' : undefined, fontWeight: r.strong ? 600 : 400 }}>{M(r.comb)}</span>
        </div>
      ))}
    </section>
  )
}

function DocList({ title, docs, onOpen, onRemove }) {
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="grouphead"><div><span className="gname">{title}</span><div className="when" style={{ marginTop: 1 }}>{docs.length} file{docs.length === 1 ? '' : 's'}</div></div></div>
      {docs.length === 0 && <div style={{ color: 'var(--faint)', fontSize: 13, paddingTop: 8 }}>Nothing here yet.</div>}
      {docs.map((d) => (
        <div className="row" key={d.id}>
          <div style={{ flex: 1 }}>
            <span>{d.file_name}</span>
            {d.doc_type && <span className="tag">{d.doc_type}</span>}
            {d.year_end && <span className="tag good">year-end</span>}
            <div className="when">{d.note ? d.note + ' · ' : ''}{(d.size_bytes / 1024).toFixed(0)} KB · {new Date(d.uploaded_at).toLocaleDateString()}</div>
          </div>
          <button className="ghost" onClick={() => onOpen(d)}>Open</button>
          {onRemove && <button className="danger-btn" onClick={() => onRemove(d)}>✕</button>}
        </div>
      ))}
    </section>
  )
}
