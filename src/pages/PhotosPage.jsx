import { useLang } from '../lib/LangContext'
import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'
import { Toast } from '../components/Toast'

export default function PhotosPage({ session }) {
  const { t } = useLang()
  const [tab, setTab] = useState('timeline')
  const [photos, setPhotos] = useState([])
  const [photoType, setPhotoType] = useState('face')
  const [showUpload, setShowUpload] = useState(false)
  const [uploadType, setUploadType] = useState('face')
  const [uploading, setUploading] = useState(false)
  const [compareA, setCompareA] = useState(null)
  const [compareB, setCompareB] = useState(null)
  const [observation, setObservation] = useState(null)
  const [observing, setObserving] = useState(false)
  const fileRef = useRef()

  async function fetchPhotos() {
    const { data } = await supabase
      .from('progress_photos')
      .select('*')
      .eq('user_id', session.user.id)
      .order('photo_date', { ascending: false })
    setPhotos(data || [])
  }

  useEffect(() => { fetchPhotos() }, [session.user.id])

  const filtered = photos.filter(p => p.photo_type === photoType)

  async function handleUpload(file) {
    if (!file) return
    setUploading(true)

    // Use actual mime type and correct extension
    const mimeType = file.type || 'image/jpeg'
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('heic') ? 'heic' : 'jpg'
    const path = `${session.user.id}/${uploadType}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('progress-photos')
      .upload(path, file, { contentType: mimeType, upsert: false })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      showToast(t('photos_upload_failed'))
      setUploading(false)
      return
    }

    await supabase.from('progress_photos').insert({
      user_id: session.user.id,
      photo_date: format(new Date(), 'yyyy-MM-dd'),
      photo_type: uploadType,
      storage_path: path,
    })

    showToast(t('photos_saved'))
    setUploading(false)
    setShowUpload(false)
    fetchPhotos()
  }

  async function getPhotoUrl(path) {
    const { data } = await supabase.storage.from('progress-photos').createSignedUrl(path, 3600)
    return data?.signedUrl
  }

  async function runObservation() {
    if (!compareA || !compareB) return
    setObserving(true)
    setObservation(null)

    try {
      const [urlA, urlB] = await Promise.all([getPhotoUrl(compareA.storage_path), getPhotoUrl(compareB.storage_path)])

      const response = await fetch('/.netlify/functions/claude-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20251001',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: urlA } },
              { type: 'image', source: { type: 'url', url: urlB } },
              { type: 'text', text: `These are two progress photos of the same person taken on different dates. The first photo is from ${format(new Date(compareA.photo_date), 'd MMM yyyy')} and the second is from ${format(new Date(compareB.photo_date), 'd MMM yyyy')}. Photo type: ${photoType === 'face' ? 'face/head' : 'upper body'}. Please provide a brief, honest, and encouraging observation about any visible physical changes between the two photos. Focus on positive changes while being realistic. Keep it to 3-4 sentences. Do not mention specific measurements or make medical claims.` }
            ]
          }]
        })
      })
      const data = await response.json()
      const text = data.content?.[0]?.text || 'Could not generate observation.'
      setObservation(text)
    } catch (e) {
      setObservation('Unable to generate observation at this time.')
    }
    setObserving(false)
  }

  async function saveObservation() {
    if (!compareB || !observation) return
    await supabase.from('progress_photos').update({ ai_observation: observation }).eq('id', compareB.id)
    showToast('Observation saved')
    setObservation(null)
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header-title">{`${t('photos_title')}`}</div>
          <div className="page-header-sub">Private · never shared</div>
        </div>
        <button onClick={() => setShowUpload(true)} style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--green-light)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="11" rx="2" stroke="var(--green)" strokeWidth="1.3"/><circle cx="8" cy="7.5" r="2.5" stroke="var(--green)" strokeWidth="1.3"/><path d="M5.5 2L6.3 1h3.4l.8 1" stroke="var(--green)" strokeWidth="1.3"/></svg>
        </button>
      </div>

      <div className="tabs-bar">
        <button className={`tab-btn ${tab === 'timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}>Timeline</button>
        <button className={`tab-btn ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Compare</button>
      </div>

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px 4px', background: 'var(--surface)', borderBottom: '0.5px solid var(--border)' }}>
        {['face', 'upper_body'].map(ptype => (
          <button key={ptype} onClick={() => setPhotoType(ptype)} style={{ flex: 1, padding: '7px', borderRadius: 8, border: '0.5px solid var(--border)', background: photoType === ptype ? 'var(--green-light)' : 'var(--surface2)', color: photoType === ptype ? 'var(--green)' : 'var(--text2)', fontWeight: photoType === ptype ? 600 : 400, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            {ptype === 'face' ? t('photos_face') : t('photos_upper')}
          </button>
        ))}
      </div>

      <div className="page-section">

        {tab === 'timeline' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {filtered.map(photo => (
                <PhotoThumb key={photo.id} photo={photo} userId={session.user.id} />
              ))}
              <button onClick={() => setShowUpload(true)} style={{ aspectRatio: '3/4', borderRadius: 10, border: '1px dashed var(--border2)', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </div>
                <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>Add photo</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>This week</span>
              </button>
            </div>

            <div className="card">
              <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  'Stored privately in Supabase Storage',
                  'Never used in reports or AI analysis',
                  'Only visible to you, on your account',
                ].map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="6" width="8" height="6" rx="1.5" stroke="var(--green)" strokeWidth="1.1"/><path d="M5 6V4.5a2 2 0 014 0V6" stroke="var(--green)" strokeWidth="1.1" strokeLinecap="round"/></svg>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'compare' && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text2)', padding: '2px 2px 6px' }}>Select two photos to compare</div>

            {/* Photo strip */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {filtered.map(photo => (
                <div key={photo.id} onClick={() => {
                  if (!compareA || (compareA && compareB)) { setCompareA(photo); setCompareB(null); setObservation(null) }
                  else if (compareA && !compareB && photo.id !== compareA.id) { setCompareB(photo); setObservation(null) }
                }} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <div style={{ width: 52, height: 68, borderRadius: 7, background: 'var(--surface2)', border: `1.5px solid ${compareA?.id === photo.id ? 'var(--blue)' : compareB?.id === photo.id ? 'var(--green)' : 'var(--border)'}`, overflow: 'hidden' }}>
                    <PhotoImage path={photo.storage_path} userId={session.user.id} />
                  </div>
                  <div style={{ fontSize: 9, color: compareA?.id === photo.id ? 'var(--blue)' : compareB?.id === photo.id ? 'var(--green)' : 'var(--text3)', fontWeight: compareA?.id === photo.id || compareB?.id === photo.id ? 700 : 400 }}>
                    {format(new Date(photo.photo_date), 'd MMM')}
                  </div>
                </div>
              ))}
            </div>

            {compareA && compareB ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[{ photo: compareA, label: 'Earlier', color: 'var(--blue)' }, { photo: compareB, label: 'Latest', color: 'var(--green)' }].map(({ photo, label, color }) => (
                    <div key={photo.id} style={{ borderRadius: 10, border: `0.5px solid var(--border)`, overflow: 'hidden' }}>
                      <div style={{ padding: '5px 8px', fontSize: 10, fontWeight: 700, color, background: 'var(--surface2)', borderBottom: '0.5px solid var(--border)' }}>
                        {label} · {format(new Date(photo.photo_date), 'd MMM')}
                      </div>
                      <div style={{ aspectRatio: '3/4', background: 'var(--surface2)' }}>
                        <PhotoImage path={photo.storage_path} userId={session.user.id} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ padding: '5px 8px', background: 'var(--surface)' }}>
                        {photo.weight_at_time && <div style={{ fontSize: 10, fontWeight: 600 }}>{photo.weight_at_time} kg</div>}
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{format(new Date(photo.photo_date), 'd MMM yyyy')}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI observation */}
                {!observation && (
                  <button onClick={runObservation} disabled={observing} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {observing ? <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--green-light)', borderTopColor: 'var(--green)', animation: 'spin 0.8s linear infinite' }} /> : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 3 3.5.5-2.5 2.5.5 3.5L7 9l-3 1.5.5-3.5L2 4.5l3.5-.5L7 1z" stroke="var(--green)" strokeWidth="1.1" strokeLinejoin="round"/></svg>}
                    </div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{observing ? 'Analysing photos...' : 'Get AI visual observation'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>Optional · Claude describes visible changes</div>
                    </div>
                  </button>
                )}

                {observation && (
                  <div className="card">
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.2 2.5 2.8.4-2 2 .4 2.8L6 7.5l-2.4 1.2.4-2.8-2-2 2.8-.4L6 1z" stroke="var(--green)" strokeWidth="1" strokeLinejoin="round"/></svg>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Claude observation</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65, marginBottom: 12 }}>{observation}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
                        Private analysis · photos sent securely · never stored externally
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-secondary" onClick={() => setObservation(null)} style={{ flex: 1, textAlign: 'center' }}>Discard</button>
                        <button className="btn-primary" onClick={saveObservation} style={{ flex: 1 }}>Save</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)', fontSize: 13 }}>
                {compareA ? 'Now tap a second photo to compare' : 'Tap a photo to start'}
              </div>
            )}
          </>
        )}

        <div style={{ height: 8 }} />
      </div>

      {/* Upload sheet */}
      {showUpload && (
        <div className="sheet-overlay" onClick={() => setShowUpload(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">Add progress photo</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', padding: '0 20px 12px' }}>
              Week of {format(new Date(), 'd MMM yyyy')}
            </div>
            <div className="sheet-divider" />

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>Photo type</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[{ key: 'face', label: t('photos_face'), sub: 'Jawline, face definition' }, { key: 'upper_body', label: t('photos_upper'), sub: 'Torso, shoulders' }].map(opt => (
                    <button key={opt.key} onClick={() => setUploadType(opt.key)} style={{ padding: '14px 10px', borderRadius: 12, border: `0.5px solid ${uploadType === opt.key ? 'var(--green)' : 'var(--border)'}`, background: uploadType === opt.key ? 'var(--green-light)' : 'var(--surface2)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: uploadType === opt.key ? 'var(--green)' : 'var(--text)' }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 8 }}>Source</div>
                <input ref={fileRef} type="file" accept="image/*,image/heic,image/heif" style={{ display: 'none' }} onChange={e => { handleUpload(e.target.files[0]); e.target.value = '' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => fileRef.current?.click()} style={{ flex: 1, padding: 10, borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: 'var(--text2)' }}>
                    {t('photos_camera')}
                  </button>
                </div>
              </div>

              <div className="privacy-note">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><rect x="3" y="6.5" width="8" height="6" rx="1.2" stroke="var(--text3)" strokeWidth="1.1"/><path d="M5 6.5V5a2 2 0 014 0v1.5" stroke="var(--text3)" strokeWidth="1.1" strokeLinecap="round"/></svg>
                <div className="privacy-text"><strong>Private by design.</strong> Photos are encrypted and stored only on your account. Never used in reports, AI summaries, or shared anywhere.</div>
              </div>

              {uploading && <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>Uploading...</div>}

              <button className="btn-secondary" style={{ width: '100%', textAlign: 'center' }} onClick={() => setShowUpload(false)}>Cancel</button>
              <div style={{ height: 4 }} />
            </div>
          </div>
        </div>
      )}

      <Toast />
    </>
  )
}

function PhotoThumb({ photo }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    supabase.storage.from('progress-photos').createSignedUrl(photo.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl)
    })
  }, [photo.storage_path])

  return (
    <div style={{ borderRadius: 10, border: '0.5px solid var(--border)', overflow: 'hidden', aspectRatio: '3/4', background: 'var(--surface2)', position: 'relative' }}>
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.4)', padding: '5px 8px' }}>
        <div style={{ fontSize: 10, color: 'white', fontWeight: 600 }}>{format(new Date(photo.photo_date), 'd MMM yyyy')}</div>
        {photo.weight_at_time && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)' }}>{photo.weight_at_time} kg</div>}
      </div>
    </div>
  )
}

function PhotoImage({ path, style }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    supabase.storage.from('progress-photos').createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl)
    })
  }, [path])

  if (!url) return <div style={{ width: '100%', height: '100%', background: 'var(--surface2)' }} />
  return <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />
}
