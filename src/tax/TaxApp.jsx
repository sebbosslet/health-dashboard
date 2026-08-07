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
const CATS = { llc: ['Software','Meals','Office supplies','Travel','Contractor income','Client income','Equipment','Marketing','Fees','Other'], w2: ['Wages','Bonus','Other'] }

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
      await addEntry(session.user.id, {
        entry_date: r.entry_date || new Date().toISOString().slice(0,10),
        book: r.book === 'w2' ? 'w2' : 'llc',
        direction: r.direction === 'income' ? 'income' : 'expense',
        category: r.category || null, vendor: r.vendor || null, amount: Math.abs(Number(r.amount) || 0),
        note: r.note || null, fed_withheld: r.fed_withheld ?? null, state_withheld: r.state_withheld ?? null,
        pretax: r.pretax ?? null, periods_per_year: r.periods_per_year ?? null,
        source_doc: stored.id, needs_review: r.confident === false, tax_year: year,
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

  const patch = async (id, p) => { setEntries((es) => es.map((e) => e.id === id ? { ...e, ...p } : e)); await updateEntry(id, p) }
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

function DumpView({ busy, progress, dragging, setDragging, note, error, fileRef, onDump, onDrop, entries, patch, remove, year }) {
  const recent = [...entries].sort((a,b)=>(a.created_at<b.created_at?1:-1)).slice(0,15)
  const review = recent.filter((e)=>e.needs_review)
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
          {review.map((e)=><EntryRow key={e.id} e={e} patch={patch} remove={remove} showBook />)}
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
            <div className="when">latest payslip annualised + LLC to date</div>
          </section>
          <section className="panel"><div className="eyebrow">LLC net (YTD)</div><div className="bignum" style={{color:s.llcNetYTD<0?'var(--red)':'var(--green)'}}>{M(s.llcNetYTD)}</div><div className="when">{s.counts.llcIncome+s.counts.llcExpense} entries</div></section>
          <section className="panel"><div className="eyebrow">W-2 income (YTD)</div><div className="bignum">{M(s.w2IncomeYTD)}</div><div className="when">{s.counts.w2Income} payslips</div></section>
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
          <div className="grouphead"><div><span className="gname">End-of-year prediction</span><div className="when" style={{marginTop:1}}>
            {eoy.method?.basis === 'ytd'
              ? `${eoy.method.done} paychecks banked (YTD) + ${eoy.method.remaining} projected at the current rate`
              : 'latest paycheck annualised (no YTD figures on file)'}; LLC as recorded to date
          </div></div></div>
          <Row label="W-2 taxable wages (annualised)" val={eoy.w2Taxable} />
          <Row label="LLC net (offsets income if a loss)" val={eoy.llcNet} accent={eoy.llcNet<0?'red':undefined} />
          <Row label="Adjusted gross income" val={eoy.agi} strong />
          <div className="taxsub">Liability</div>
          <Row label="Federal (incl. SE tax)" val={eoy.fedLiability} />
          <Row label="State (VA)" val={eoy.stateLiability} />
          <Row label="Total liability" val={eoy.totalLiability} strong />
          <div className="taxsub">Settlement</div>
          <Row label="Total withheld" val={eoy.totalWithheld} />
          <Row label={eoy.owes?'Balance owed':'Refund'} val={Math.abs(eoy.refund)} strong accent={eoy.owes?'red':'green'} />
          <div className="legend" style={{ marginTop: 10 }}>Estimate only, not tax advice. 2025 brackets, single filer, Virginia, standard deduction; ignores credits, itemising and QBI.</div>
        </section>
      )}
    </>
  )
}
