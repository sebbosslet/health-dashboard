import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { summarise, predictEOY } from './engine'
import { addEntry, updateEntry, deleteEntry, listEntries, uploadFile, signedUrl } from './store'
import { extractDocument } from './extract'
import '../cashflow/cashflow.css' // shared design tokens only

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const M = (n) => usd.format(Number(n) || 0)
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const monthKey = (d) => d.slice(0, 7)
const monthName = (k) => `${MONTHS[+k.slice(5,7)-1]} ${k.slice(0,4)}`
const prettyDate = (d) => d ? `${MONTHS[+d.slice(5,7)-1]} ${+d.slice(8,10)}, ${d.slice(0,4)}` : ''
const CATS = { llc: ['Ingredients & supplies','Equipment','Software','Props & styling','Meals','Travel','Marketing','Office supplies','Contractor income','Client income','Fees','Other'], w2: ['Wages','Bonus','Other'] }

export default function TaxApp({ session, advisor = false }) {
  const year = new Date().getFullYear()
  const [tab, setTab] = useState(advisor ? 'ledger' : 'dump')
  const [entries, setEntries] = useState([])
  const [progress, setProgress] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const busy = !!progress
  const refresh = async () => setEntries(await listEntries(advisor ? null : session.user.id, year))
  useEffect(() => { refresh() }, [session.user.id]) // eslint-disable-line

  const processOne = async (file) => {
    const result = await extractDocument(file)
    const stored = await uploadFile(session.user.id, file, result.doc_kind, year)
    const rows = result.entries?.length ? result.entries : [{ entry_date: new Date().toISOString().slice(0,10), book: 'llc', direction: 'expense', category: 'Other', amount: 0, confident: false }]
    for (const r of rows) {
      // If the stub states federal taxable wages, trust it: pre-tax = gross − taxable.
      // This avoids guessing which deduction lines are pre-tax.
      const gross = Math.abs(Number(r.amount) || 0)
      const statedPretax = (r.taxable_this != null && gross > 0)
        ? Math.max(0, Math.round((gross - Number(r.taxable_this)) * 100) / 100)
        : (r.pretax ?? null)
      await addEntry(session.user.id, {
        entry_date: r.entry_date || new Date().toISOString().slice(0,10),
        book: r.book === 'w2' ? 'w2' : 'llc',
        direction: r.direction === 'income' ? 'income' : 'expense',
        category: r.category || null, vendor: r.vendor || null, amount: gross,
        note: r.note || null, fed_withheld: r.fed_withheld ?? null, state_withheld: r.state_withheld ?? null,
        pretax: statedPretax, periods_per_year: r.periods_per_year ?? null,
        ytd_gross: r.ytd_gross ?? null, ytd_fed: r.ytd_fed ?? null,
        ytd_state: r.ytd_state ?? null, ytd_pretax: r.ytd_pretax ?? null,
        check_number: r.check_number ?? null,
        source_doc: stored.id,
        // a payslip with no YTD extracted is worth reviewing — the forecast needs it
        needs_review: r.confident === false || (r.book === 'w2' && r.direction === 'income' && r.ytd_gross == null),
        tax_year: year,
      })
    }
    return rows.length
  }

  const ACCEPT = /\.(pdf|png|jpe?g|webp|heic)$/i
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => ACCEPT.test(f.name))
    if (!files.length) { setError('No supported files — use PDF or an image.'); return }
    setError(null); setNote(null)
    setProgress({ total: files.length, done: 0, current: files[0].name, added: 0, failed: [] })
    let added = 0; const failed = []
    for (let i = 0; i < files.length; i++) {
      setProgress((p) => ({ ...p, current: files[i].name, done: i }))
      try { added += await processOne(files[i]) }
      catch (err) { failed.push(`${files[i].name}: ${err.message}`) }
    }
    setProgress(null)
    await refresh()
    const ok = files.length - failed.length
    setNote(`Processed ${ok}/${files.length} file${files.length === 1 ? '' : 's'} · ${added} ${added === 1 ? 'entry' : 'entries'} added`)
    if (failed.length) setError(failed.join(' · '))
  }

  const onDump = (e) => { handleFiles(e.target.files); if (fileRef.current) fileRef.current.value = '' }
  const onDrop = (e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }

  const patch = async (id, p) => {
    // Editing the book or category counts as reviewing it — clear the flag so
    // the change is visible and the row leaves "Needs review".
    const clears = ('book' in p || 'category' in p)
    const full = clears ? { ...p, needs_review: false } : p
    setEntries((es) => es.map((e) => e.id === id ? { ...e, ...full } : e))
    await updateEntry(id, full)
  }
  const remove = async (id) => { if (confirm('Delete this entry?')) { await deleteEntry(id); refresh() } }
  const openDoc = async (e) => { if (!e.source_doc) return; const path = e._path; if (path) { const u = await signedUrl(path); if (u) window.open(u, '_blank') } }

  const summary = useMemo(() => summarise(entries), [entries])
  const eoy = useMemo(() => predictEOY(summary), [summary])

  return (
    <div className="cf-root">
      <nav className="side">
        <Link className="wordmark" to="/" title="All apps">sebs<span>.</span>tax</Link>
        {!advisor && <Link className="navbtn" to="/">← apps</Link>}
        {!advisor && <button className={`navbtn ${tab==='dump'?'on':''}`} onClick={()=>setTab('dump')}>Add documents</button>}
        <button className={`navbtn ${tab==='ledger'?'on':''}`} onClick={()=>setTab('ledger')}>Ledger</button>
        <button className={`navbtn ${tab==='summary'?'on':''}`} onClick={()=>setTab('summary')}>Summary</button>
        <div style={{ marginTop: 'auto', padding: '0 8px' }}>
          <button className="ghost" style={{ fontSize: 12 }} onClick={()=>import('../lib/supabase').then(m=>m.supabase.auth.signOut())}>Sign out</button>
        </div>
      </nav>

      <main className="main">
        {advisor && <div className="notice" style={{ marginBottom: 16 }}><span style={{ color:'var(--mut)' }}>Advisor view — LLC income and expenses, and W-2 income totals. Ongoing payslips are not shared.</span></div>}

        {tab === 'dump' && !advisor && <DumpView {...{ busy, progress, dragging, setDragging, note, error, fileRef, onDump, onDrop, handleFiles, entries, patch, remove, year }} />}
        {tab === 'ledger' && <LedgerView entries={entries} patch={advisor ? null : patch} remove={advisor ? null : remove} />}
        {tab === 'summary' && <SummaryView summary={summary} eoy={eoy} advisor={advisor} />}
      </main>
    </div>
  )
}

const Field = ({ lab, children }) => <label><div className="lab">{lab}</div>{children}</label>

function EntryRow({ e, patch, remove, showBook }) {
  const editable = !!patch
  return (
    <div className={`taxrow${e.needs_review ? ' review' : ''}`} style={{ gridTemplateColumns: showBook ? '80px 92px 1fr 120px 96px 30px' : '92px 1fr 130px 100px 30px' }}>
      {showBook && (editable
        ? <select className="mini" value={e.book} onChange={(ev)=>patch(e.id,{book:ev.target.value})}><option value="llc">LLC</option><option value="w2">W-2</option></select>
        : <span className="tag">{e.book==='w2'?'W-2':'LLC'}</span>)}
      {editable
        ? <input className="mini" type="date" value={e.entry_date} onChange={(ev)=>patch(e.id,{entry_date:ev.target.value})} />
        : <span className="when">{e.entry_date}</span>}
      <span className="tl">{e.vendor || e.category || '—'}{e.vendor && e.category ? <span className="when"> · {e.category}</span> : ''}{e.needs_review && <span className="tag review-tag">review</span>}</span>
      {editable
        ? <select className="mini" value={e.category || ''} onChange={(ev)=>patch(e.id,{category:ev.target.value})}>
            <option value="">Category…</option>
            {(CATS[e.book]||CATS.llc).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        : <span className="when">{e.category}</span>}
      <span className="num" style={{ color: e.direction==='income'?'var(--green)':'var(--ink)', textAlign:'right' }}>
        {e.direction==='income'?'+':'−'}{M(e.amount)}
      </span>
      {editable ? <button className="danger-btn" onClick={()=>remove(e.id)}>✕</button> : <span />}
    </div>
  )
}

function PayslipFigures({ e, patch }) {
  const f = (k, lab) => (
    <label style={{ display:'flex', flexDirection:'column', gap:2 }}>
      <span className="lab">{lab}</span>
      <input className="mini" type="number" value={e[k] ?? ''} onChange={(ev)=>patch(e.id,{[k]: ev.target.value===''?null:Number(ev.target.value)})} />
    </label>
  )
  const missingYTD = e.ytd_gross == null
  return (
    <div className="payfig">
      <div className="payfig-head">
        Payslip figures{missingYTD && <span className="tag review-tag" style={{marginLeft:6}}>YTD missing — the forecast needs these</span>}
      </div>
      <div className="payfig-grid">
        <div className="payfig-col"><div className="payfig-col-h">This period</div>
          {f('amount','Gross')}{f('fed_withheld','Federal')}{f('state_withheld','State')}{f('pretax','Pre-tax')}
        </div>
        <div className="payfig-col"><div className="payfig-col-h">Year to date</div>
          {f('ytd_gross','Gross YTD')}{f('ytd_fed','Federal YTD')}{f('ytd_state','State YTD')}{f('ytd_pretax','Pre-tax YTD')}
        </div>
        <div className="payfig-col"><div className="payfig-col-h">Schedule</div>
          {f('periods_per_year','Checks/yr')}{f('check_number','This is check #')}
        </div>
      </div>
    </div>
  )
}

function DumpView({ busy, progress, dragging, setDragging, note, error, fileRef, onDump, onDrop, entries, patch, remove, year }) {
  const sorted = [...entries].sort((a,b)=>(a.created_at<b.created_at?1:-1))
  const review = sorted.filter((e)=>e.needs_review).slice(0,15)
  const recent = sorted.filter((e)=>!e.needs_review).slice(0,15)
  return (
    <>
      <div className="screenhead"><h1>Add documents</h1></div>
      <div
        className={`dropzone${dragging ? ' drag' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e)=>{ e.preventDefault(); if(!busy) setDragging(true) }}
        onDragLeave={(e)=>{ e.preventDefault(); setDragging(false) }}
        onDrop={busy ? (e)=>e.preventDefault() : onDrop}
        onClick={()=>{ if(!busy) fileRef.current?.click() }}
      >
        <input ref={fileRef} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" onChange={onDump} />
        {busy && progress ? (
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Reading {progress.done + 1} of {progress.total}</div>
            <div className="dropfile">{progress.current}</div>
            <div className="progbar"><div className="progfill" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
          </div>
        ) : (
          <>
            <div className="dropicon">↓</div>
            <div className="droptitle">{dragging ? 'Drop to add them' : 'Drag files here, or click to choose'}</div>
            <div className="when" style={{ marginTop: 6 }}>Payslips, W-2, 1099, receipts, invoices — several at once. Each is read, categorised, and added to your ledger.</div>
          </>
        )}
      </div>
      {note && <div className="notice" style={{ marginBottom: 12 }}><span style={{ color:'var(--green)', fontWeight:600 }}>{note}</span></div>}
      {error && <div className="notice bad" style={{ marginBottom: 12 }}><span className="danger">{error}</span></div>}

      {review.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="grouphead"><div><span className="gname">Needs review</span><div className="when" style={{marginTop:1}}>the detection wasn't sure — confirm the book and category</div></div></div>
          {review.map((e)=>(
            <div key={e.id}>
              <EntryRow e={e} patch={patch} remove={remove} showBook />
              {e.book==='w2' && e.direction==='income' && <PayslipFigures e={e} patch={patch} />}
              <div style={{ display:'flex', justifyContent:'flex-end', margin:'2px 0 10px' }}>
                <button className="ghost" style={{ fontSize:12 }} onClick={()=>patch(e.id,{ needs_review:false })}>Looks right — clear</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="grouphead"><div><span className="gname">Recently added</span></div></div>
        {recent.length===0 && <div style={{color:'var(--faint)',fontSize:13,paddingTop:8}}>Nothing yet — upload your first document.</div>}
        {recent.map((e)=><EntryRow key={e.id} e={e} patch={patch} remove={remove} showBook />)}
      </section>
    </>
  )
}

function LedgerView({ entries, patch, remove }) {
  const [book, setBook] = useState('llc')
  const rows = entries.filter((e)=>e.book===book).sort((a,b)=>(a.entry_date<b.entry_date?-1:1))
  const byMonth = useMemo(()=>{
    const m = new Map()
    for (const e of rows) { const k=monthKey(e.entry_date); if(!m.has(k))m.set(k,[]); m.get(k).push(e) }
    return [...m.entries()].sort((a,b)=>(a[0]<b[0]?-1:1))
  }, [rows])
  const inc = (a)=>a.filter(e=>e.direction==='income').reduce((s,e)=>s+Number(e.amount),0)
  const exp = (a)=>a.filter(e=>e.direction==='expense').reduce((s,e)=>s+Number(e.amount),0)
  return (
    <>
      <div className="screenhead">
        <h1>Ledger</h1>
        <div className="rbtns">
          <button className={book==='llc'?'active':'ghost'} onClick={()=>setBook('llc')}>LLC (business)</button>
          <button className={book==='w2'?'active':'ghost'} onClick={()=>setBook('w2')}>W-2 (employment)</button>
        </div>
      </div>
      {byMonth.length===0 && <section className="panel"><div style={{color:'var(--faint)',fontSize:13}}>No {book==='llc'?'business':'employment'} entries yet.</div></section>}
      {byMonth.map(([k, list])=>(
        <section className="panel" key={k} style={{ marginBottom: 14 }}>
          <div className="grouphead">
            <div><span className="gname">{monthName(k)}</span></div>
            <span className="amt">{book==='llc'
              ? <>net <b style={{color: inc(list)-exp(list)>=0?'var(--green)':'var(--red)'}}>{M(inc(list)-exp(list))}</b> <span style={{color:'var(--faint)'}}>· +{M(inc(list))} −{M(exp(list))}</span></>
              : <>income <b style={{color:'var(--green)'}}>{M(inc(list))}</b></>}
            </span>
          </div>
          {list.map((e)=><EntryRow key={e.id} e={e} patch={patch} remove={remove} showBook={false} />)}
        </section>
      ))}
    </>
  )
}

function Split3({ label, y, r, f, strong }) {
  const C = ({ v }) => <span className="num" style={{ textAlign:'right', fontWeight: strong?600:400 }}>{usd.format(Number(v)||0)}</span>
  return (
    <div className={`taxrow${strong?' strong':''}`} style={{ gridTemplateColumns:'1.4fr 1fr 1fr 1fr' }}>
      <span className="tl">{label}</span><C v={y} /><C v={r} /><C v={f} />
    </div>
  )
}

function TaxDetail({ eoy }) {
  const d = eoy.detail
  const pct = (r) => `${(r*100).toFixed(r*100 % 1 === 0 ? 0 : 2)}%`
  const band = (b) => b.to == null ? `over ${M(b.from)}` : `${M(b.from)}–${M(b.to)}`
  const R = ({ label, val, strong, accent, sub, indent }) => (
    <div className={`taxrow${strong?' strong':''}`} style={{ gridTemplateColumns:'1fr 140px' }}>
      <span className="tl" style={{ paddingLeft: indent?18:0, color: sub?'var(--mut)':undefined, fontSize: sub?12.5:undefined }}>{label}</span>
      <span className="num" style={{ textAlign:'right', color: accent==='green'?'var(--green)':accent==='red'?'var(--red)':undefined, fontWeight: strong?600:400 }}>{M(val)}</span>
    </div>
  )
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="grouphead"><div><span className="gname">End-of-year tax, line by line</span><div className="when" style={{marginTop:1}}>how the projected liability is built up</div></div>
        <span className="amt">effective rate <b>{d.effectiveRate}%</b></span>
      </div>

      <div className="taxsub">Income</div>
      <R label="W-2 gross wages (full year)" val={d.w2Gross} />
      <R label="less pre-tax deductions (401k, HSA, medical)" val={-d.w2Pretax} indent sub />
      <R label="W-2 taxable wages" val={d.w2Taxable} />
      <R label="LLC net (Schedule C)" val={d.llcNet} accent={d.llcNet<0?'red':undefined} />
      {d.halfSE>0 && <R label="less ½ self-employment tax deduction" val={-d.halfSE} indent sub />}
      <R label="Adjusted gross income (AGI)" val={d.agi} strong />

      <div className="taxsub">Federal income tax</div>
      <R label="AGI" val={d.agi} sub />
      <R label="less standard deduction" val={-d.fedStd} indent sub />
      <R label="Federal taxable income" val={d.fedTaxableIncome} />
      {d.fedBrackets.map((b,i)=>(
        <R key={i} label={`${pct(b.rate)} on ${band(b)} — ${M(b.amount)}`} val={b.tax} indent sub />
      ))}
      <R label="Federal income tax" val={d.fedIncomeTax} strong />
      {d.seTax>0 && <>
        <R label={`Self-employment tax (15.3% on ${M(d.seBase)})`} val={d.seTax} />
      </>}
      {d.seTax>0 && <R label="Federal total (income + SE)" val={d.fedTotal} strong />}

      <div className="taxsub">Virginia income tax</div>
      <R label="W-2 taxable + LLC net" val={d.w2Taxable + d.llcNet} sub />
      <R label="less VA standard deduction" val={-d.vaStd} indent sub />
      <R label="VA taxable income" val={d.stateTaxableIncome} />
      {d.stateBrackets.map((b,i)=>(
        <R key={i} label={`${pct(b.rate)} on ${band(b)} — ${M(b.amount)}`} val={b.tax} indent sub />
      ))}
      <R label="Virginia income tax" val={d.stateTax} strong />

      <div className="taxsub">Total tax & settlement</div>
      <R label="Total tax liability (federal + state)" val={eoy.totalLiability} strong />
      <R label="Federal withheld (full year)" val={-eoy.fedWithheld} indent sub />
      <R label="State withheld (full year)" val={-eoy.stateWithheld} indent sub />
      <R label={eoy.owes?'Balance owed':'Projected refund'} val={Math.abs(eoy.refund)} strong accent={eoy.owes?'red':'green'} />

      <div className="legend" style={{ marginTop: 12 }}>
        Estimate only, not tax advice. 2025 brackets, single filer, Virginia, standard deduction.
        Ignores tax credits, itemised deductions, QBI (which could reduce this further), and any other income.
        {d.llcNet<0 && ' Your LLC loss reduces taxable income, lowering the tax owed.'}
      </div>
    </section>
  )
}

function SummaryView({ summary: s, eoy, advisor }) {
  const now = new Date()
  const monthsElapsed = now.getMonth() + 1
  const Row = ({ label, val, strong, accent }) => (
    <div className={`taxrow${strong?' strong':''}`} style={{ gridTemplateColumns:'1fr 130px' }}>
      <span className="tl">{label}</span>
      <span className="num" style={{ textAlign:'right', color: accent==='green'?'var(--green)':accent==='red'?'var(--red)':undefined, fontWeight: strong?600:400 }}>{M(val)}</span>
    </div>
  )
  return (
    <>
      <div className="screenhead"><h1>Summary · {new Date().getFullYear()}</h1></div>

      {!advisor && eoy && (
        <div className="statgrid" style={{ marginBottom: 16 }}>
          <section className="panel">
            <div className="eyebrow">Projected {eoy.owes?'balance owed':'refund'}</div>
            <div className="bignum" style={{ color: eoy.owes?'var(--red)':'var(--green)' }}>{M(Math.abs(eoy.refund))}</div>
            <div className="when">{eoy.asOf ? `as of your ${prettyDate(eoy.asOf)} payslip` : 'from your latest payslip + LLC to date'}</div>
          </section>
          <section className="panel"><div className="eyebrow">LLC net (YTD)</div><div className="bignum" style={{color:s.llcNetYTD<0?'var(--red)':'var(--green)'}}>{M(s.llcNetYTD)}</div><div className="when">{s.counts.llcIncome+s.counts.llcExpense} entries</div></section>
          <section className="panel"><div className="eyebrow">W-2 income (YTD)</div><div className="bignum">{M(s.w2IncomeYTD)}</div><div className="when">{s.w2FromYTD ? 'from your payslip YTD' : `${s.counts.w2Income} payslip${s.counts.w2Income===1?'':'s'} on file`}</div></section>
        </div>
      )}

      <section className="panel">
        <div className="grouphead"><div><span className="gname">Year to date</span></div></div>
        <div className="taxsub">LLC (business)</div>
        <Row label="Income" val={s.llcIncomeYTD} accent="green" />
        <Row label="Expenses" val={-s.llcExpenseYTD} />
        <Row label="Net" val={s.llcNetYTD} strong accent={s.llcNetYTD<0?'red':'green'} />
        <div className="taxsub">W-2 (employment)</div>
        <Row label="Income" val={s.w2IncomeYTD} accent="green" />
      </section>

      {!advisor && eoy && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="grouphead"><div><span className="gname">Full-year W-2 forecast</span><div className="when" style={{marginTop:1}}>
            {eoy.method?.basis === 'ytd'
              ? `${eoy.method.done} paychecks banked + ${eoy.method.remaining} projected at the current rate, as of ${prettyDate(eoy.asOf)}`
              : 'no YTD figures on file — the whole year is projected from your latest paycheck'}
          </div></div></div>
          <div className="taxhead" style={{ gridTemplateColumns:'1.4fr 1fr 1fr 1fr' }}>
            <span>W-2 figure</span><span>YTD actual</span><span>Rest of year</span><span>Full year</span>
          </div>
          <Split3 label="Gross wages" y={eoy.split.ytd.gross} r={eoy.split.roy.gross} f={eoy.split.full.gross} />
          <Split3 label="Pre-tax deductions" y={-eoy.split.ytd.pretax} r={-eoy.split.roy.pretax} f={-eoy.split.full.pretax} />
          <Split3 label="Federal withheld" y={eoy.split.ytd.fed} r={eoy.split.roy.fed} f={eoy.split.full.fed} />
          <Split3 label="State withheld" y={eoy.split.ytd.state} r={eoy.split.roy.state} f={eoy.split.full.state} strong />
        </section>
      )}

      {!advisor && eoy && <TaxDetail eoy={eoy} />}
    </>
  )
}
