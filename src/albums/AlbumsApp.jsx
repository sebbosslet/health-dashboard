import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAlbums, createAlbum, deleteAlbum, fetchAlbum, ownerUploadPhoto, ownerAddNote, deletePhoto, deleteNote, shareLink } from './store'
import { exifDate } from './exif'
import { groupByDay, DiaryDays } from './Diary'
import '../cashflow/cashflow.css'
import './albums.css'

export default function AlbumsApp({ session }) {
  const [albums, setAlbums] = useState(null)
  const [open, setOpen] = useState(null)       // open album detail
  const [form, setForm] = useState({ title: '', subtitle: '', start_date: '', end_date: '' })
  const [creating, setCreating] = useState(false)

  const refresh = () => listAlbums(session.user.id).then(setAlbums)
  useEffect(() => { refresh() }, [session.user.id]) // eslint-disable-line

  if (open) return <AlbumDetail session={session} albumId={open} onBack={() => { setOpen(null); refresh() }} />

  return (
    <div className="cf-root">
      <nav className="side">
        <Link className="wordmark" to="/" title="All apps">sebs<span>.</span>trips</Link>
        <Link className="navbtn" to="/">← apps</Link>
        <div className="navbtn on">Albums</div>
      </nav>
      <main className="main">
        <div className="screenhead"><h1>Vacation diaries</h1></div>

        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="grouphead"><div><span className="gname">New album</span><div className="when" style={{marginTop:1}}>one per trip</div></div></div>
          <div className="formgrid" style={{ marginTop: 8 }}>
            <label><div className="lab">Title</div><input value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} placeholder="Europe with Dad" /></label>
            <label><div className="lab">Subtitle</div><input value={form.subtitle} onChange={(e)=>setForm({...form,subtitle:e.target.value})} placeholder="Tuscany, September 2026" /></label>
            <label><div className="lab">Start</div><input type="date" value={form.start_date} onChange={(e)=>setForm({...form,start_date:e.target.value})} /></label>
            <label><div className="lab">End</div><input type="date" value={form.end_date} onChange={(e)=>setForm({...form,end_date:e.target.value})} /></label>
            <div style={{display:'flex',alignItems:'end'}}>
              <button className="primary" disabled={!form.title||creating} onClick={async()=>{
                setCreating(true); await createAlbum(session.user.id, form); setForm({title:'',subtitle:'',start_date:'',end_date:''}); await refresh(); setCreating(false)
              }}>{creating?'Creating…':'Create album'}</button>
            </div>
          </div>
        </section>

        {albums === null && <div className="eyebrow">Loading…</div>}
        {albums && albums.length === 0 && <div style={{color:'var(--faint)',fontSize:13}}>No albums yet — create your first trip above.</div>}
        <div className="albumgrid">
          {(albums||[]).map((a)=>(
            <div className="albumcard" key={a.id} onClick={()=>setOpen(a.id)}>
              <div className="albumcard-body">
                <div className="albumcard-title">{a.title}</div>
                {a.subtitle && <div className="when">{a.subtitle}</div>}
                <div className="when" style={{marginTop:6}}>{a.start_date || '—'}{a.end_date?` → ${a.end_date}`:''}</div>
              </div>
              <div className="albumcard-foot" onClick={(e)=>e.stopPropagation()}>
                <button className="ghost" onClick={()=>{navigator.clipboard?.writeText(shareLink(a.share_token)); }}>Copy share link</button>
                <button className="danger-btn" onClick={async()=>{ if(confirm(`Delete "${a.title}" and all its photos?`)){ await deleteAlbum(a.id); refresh() } }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

function AlbumDetail({ session, albumId, onBack }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(null)
  const fileRef = useRef(null)

  const refresh = () => fetchAlbum(albumId).then(setData)
  useEffect(() => { refresh() }, [albumId]) // eslint-disable-line

  const onFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    for (let i = 0; i < files.length; i++) {
      setBusy({ done: i, total: files.length })
      const taken = (await exifDate(files[i])) || new Date().toISOString().slice(0,10)
      try { await ownerUploadPhoto(session.user.id, albumId, files[i], { taken_on: taken }) } catch (e) { console.error(e) }
    }
    setBusy(null); if (fileRef.current) fileRef.current.value = ''; refresh()
  }

  if (!data) return <div className="cf-root"><main className="main"><div className="eyebrow">Loading…</div></main></div>
  const { album, photos, notes } = data
  const days = groupByDay(photos, notes, album)

  return (
    <div className="cf-root">
      <nav className="side">
        <button className="wordmark" onClick={onBack} style={{textAlign:'left',background:'none',border:'none',cursor:'pointer'}}>← albums</button>
        <div className="navbtn on">{album.title}</div>
        <div style={{marginTop:'auto',padding:'0 8px'}}>
          <button className="ghost" style={{fontSize:12}} onClick={()=>{navigator.clipboard?.writeText(shareLink(album.share_token))}}>Copy share link</button>
        </div>
      </nav>
      <main className="main">
        <div className="screenhead">
          <h1>{album.title}</h1>
          <button className="primary" disabled={!!busy} onClick={()=>fileRef.current?.click()}>{busy?`Uploading ${busy.done+1}/${busy.total}…`:'Add photos'}</button>
          <input ref={fileRef} type="file" hidden multiple accept="image/*" onChange={(e)=>onFiles(e.target.files)} />
        </div>
        {album.subtitle && <div className="when" style={{marginTop:-8,marginBottom:12}}>{album.subtitle}</div>}
        <DiaryDays days={days} editable
          onAddNote={async(note_date, body)=>{ await ownerAddNote(albumId,{note_date,body}); refresh() }}
          onDeletePhoto={async(id)=>{ await deletePhoto(id); refresh() }}
          onDeleteNote={async(id)=>{ await deleteNote(id); refresh() }}
        />
      </main>
    </div>
  )
}
