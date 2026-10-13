import { useState } from 'react'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const prettyDay = (d) => { const [y,m,dd]=d.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,dd)); return `${WD[dt.getUTCDay()]}, ${MONTHS[m-1]} ${dd}` }

// Group photos and notes into an ordered list of days.
export function groupByDay(photos, notes, album) {
  const map = new Map()
  const touch = (d) => { if (!map.has(d)) map.set(d, { date: d, photos: [], notes: [] }); return map.get(d) }
  for (const p of photos) touch(p.taken_on).photos.push(p)
  for (const n of notes) touch(n.note_date).notes.push(n)
  // include empty days within the trip range so the diary reads continuously
  if (album?.start_date && album?.end_date) {
    let d = album.start_date
    while (d <= album.end_date) { touch(d); d = addDay(d) }
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}
function addDay(s){ const [y,m,d]=s.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+1); return dt.toISOString().slice(0,10) }

export function DiaryDays({ days, editable, contributor, onAddNote, onDeletePhoto, onDeleteNote, onContribPhoto }) {
  if (!days.length) return <div style={{color:'var(--faint)',fontSize:13}}>No photos yet.</div>
  return (
    <div className="diary">
      {days.map((day) => (
        <section className="diaryday" key={day.date}>
          <div className="diaryday-head">
            <h2>{prettyDay(day.date)}</h2>
            <span className="when">{day.photos.length} photo{day.photos.length===1?'':'s'}</span>
          </div>

          {day.notes.map((n) => (
            <div className="diarynote" key={n.id}>
              <p>{n.body}</p>
              <div className="diarynote-by">— {n.author_name || 'Guest'}{(editable||contributor)&&onDeleteNote?<button className="linkx" onClick={()=>onDeleteNote(n.id)}>delete</button>:null}</div>
            </div>
          ))}

          <NoteAdder date={day.date} onAdd={onAddNote} contributor={contributor} />

          <div className="photogrid">
            {day.photos.map((p) => (
              <figure className="photo" key={p.id}>
                <img src={p.url} alt={p.caption||''} loading="lazy" />
                {p.caption && <figcaption>{p.caption}</figcaption>}
                {p.author_name && p.author_name!=='You' && <div className="photo-by">{p.author_name}</div>}
                {editable && onDeletePhoto && <button className="photox" onClick={()=>onDeletePhoto(p.id)}>✕</button>}
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function NoteAdder({ date, onAdd, contributor }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  if (!onAdd) return null
  if (!open) return <button className="addnote" onClick={()=>setOpen(true)}>+ Add a note for this day</button>
  return (
    <div className="noteadd">
      <textarea rows={2} autoFocus value={text} placeholder="What did we do today?" onChange={(e)=>setText(e.target.value)} />
      <div style={{display:'flex',gap:6}}>
        <button className="primary" disabled={!text.trim()} onClick={async()=>{ await onAdd(date, text.trim()); setText(''); setOpen(false) }}>Save note</button>
        <button className="ghost" onClick={()=>{setOpen(false);setText('')}}>Cancel</button>
      </div>
    </div>
  )
}
