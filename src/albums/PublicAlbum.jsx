import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { exifDate } from './exif'
import { groupByDay, DiaryDays } from './Diary'
import '../cashflow/cashflow.css'
import './albums.css'

const fn = '/.netlify/functions/album-public'

export default function PublicAlbum() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState(() => localStorage.getItem('album-author') || '')
  const [passcode, setPasscode] = useState(() => localStorage.getItem(`album-pc-${token}`) || '')
  const [locked, setLocked] = useState(false)
  const [pcInput, setPcInput] = useState('')
  const [busy, setBusy] = useState(null)
  const fileRef = useRef(null)

  const load = async (pc = passcode) => {
    try {
      const qs = `action=get&token=${encodeURIComponent(token)}${pc ? `&passcode=${encodeURIComponent(pc)}` : ''}`
      const res = await fetch(`${fn}?${qs}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not load album')
      if (j.locked) { setLocked(true); setData(null); return }
      setLocked(false); setData(j)
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [token]) // eslint-disable-line

  const call = (action, body) => fetch(fn, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token, action, passcode, ...body }) }).then(r=>r.json())

  const rememberName = (n) => { setName(n); localStorage.setItem('album-author', n) }

  const onFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    for (let i = 0; i < files.length; i++) {
      setBusy({ done:i, total:files.length })
      const f = files[i]
      const taken = (await exifDate(f)) || new Date().toISOString().slice(0,10)
      try {
        const ext = (f.name.split('.').pop()||'jpg').toLowerCase()
        const sign = await call('sign_upload', { ext })
        if (sign.error) throw new Error(sign.error)
        // upload the bytes to the signed URL
        const put = await fetch(sign.signedUrl, { method:'PUT', headers:{'Content-Type':f.type}, body:f })
        if (!put.ok) throw new Error('Upload failed')
        await call('add_photo', { storage_path: sign.path, taken_on: taken, author_name: name || 'Guest' })
      } catch (e) { console.error(e) }
    }
    setBusy(null); if (fileRef.current) fileRef.current.value=''; load()
  }

  if (error) return <div className="cf-root"><main className="main" style={{alignItems:'center',justifyContent:'center'}}><div className="notice bad"><span className="danger">{error}</span></div></main></div>
  if (locked) return (
    <div className="cf-root"><main className="main" style={{alignItems:'center',justifyContent:'center'}}>
      <section className="panel" style={{ maxWidth: 360, width:'100%', textAlign:'center' }}>
        <div className="eyebrow" style={{marginBottom:10}}>This album needs a passcode</div>
        <input type="password" placeholder="Passcode" value={pcInput} autoFocus
          onChange={(e)=>setPcInput(e.target.value)}
          onKeyDown={(e)=>{ if(e.key==='Enter'){ setPasscode(pcInput); localStorage.setItem(`album-pc-${token}`, pcInput); load(pcInput) } }}
          style={{ width:'100%', marginBottom:10 }} />
        <button className="primary" style={{width:'100%'}} onClick={()=>{ setPasscode(pcInput); localStorage.setItem(`album-pc-${token}`, pcInput); load(pcInput) }}>Open album</button>
      </section>
    </main></div>
  )
  if (!data) return <div className="cf-root"><main className="main"><div className="eyebrow">Loading…</div></main></div>

  const days = groupByDay(data.photos, data.notes, data.album)
  return (
    <div className="cf-root">
      <main className="main" style={{ maxWidth: 820, margin:'0 auto' }}>
        <div className="screenhead" style={{ flexWrap:'wrap' }}>
          <div>
            <h1>{data.album.title}</h1>
            {data.album.subtitle && <div className="when" style={{marginTop:2}}>{data.album.subtitle}</div>}
          </div>
          <button className="primary" disabled={!!busy} onClick={()=>{ if(!name){ const n=prompt('Your name (shown on what you add):'); if(!n) return; rememberName(n) } fileRef.current?.click() }}>
            {busy?`Uploading ${busy.done+1}/${busy.total}…`:'Add your photos'}
          </button>
          <input ref={fileRef} type="file" hidden multiple accept="image/*" onChange={(e)=>onFiles(e.target.files)} />
        </div>

        <div className="notice" style={{ margin:'4px 0 16px' }}>
          <span style={{color:'var(--mut)'}}>
            {name ? <>Adding as <b>{name}</b>. <button className="linkx" onClick={()=>{const n=prompt('Your name:', name); if(n) rememberName(n)}}>change</button></>
                  : 'You can add photos and notes to any day. Your photos keep their original date.'}
          </span>
        </div>

        <DiaryDays days={days} contributor
          onAddNote={async(note_date, body)=>{ if(!name){ const n=prompt('Your name:'); if(!n) return; rememberName(n) } await call('add_note',{ note_date, body, author_name: name||'Guest' }); load() }}
        />
      </main>
    </div>
  )
}
