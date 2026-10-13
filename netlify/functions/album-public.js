import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}
const admin = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) })
const bad = (code, msg) => ({ statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) })

// Resolve an album by its share token. Everything here is gated on possession
// of the token — the tables are otherwise unreadable by the anon key.
async function albumByToken(db, token) {
  if (!token) return null
  const { data } = await db.from('albums').select('*').eq('share_token', token).maybeSingle()
  return data || null
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  const db = admin()
  const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {}
  const token = body.token || event.queryStringParameters?.token
  const action = body.action || event.queryStringParameters?.action || 'get'

  try {
    const album = await albumByToken(db, token)
    if (!album) return bad(404, 'Album not found')

    // If the album is passcode-protected, every read and write must present it.
    if (album.passcode_hash) {
      const given = body.passcode || event.queryStringParameters?.passcode
      if (!given || sha256(given) !== album.passcode_hash) {
        return ok({ locked: true, title: album.title })  // no data leaks; just the gate
      }
    }

    if (action === 'get') {
      const [{ data: photos }, { data: notes }] = await Promise.all([
        db.from('album_photos').select('*').eq('album_id', album.id).order('taken_on').order('sort'),
        db.from('album_notes').select('*').eq('album_id', album.id).order('note_date').order('created_at'),
      ])
      const pub = process.env.SUPABASE_URL + '/storage/v1/object/public/album-photos/'
      return ok({
        album: { id: album.id, title: album.title, subtitle: album.subtitle, start_date: album.start_date, end_date: album.end_date },
        photos: (photos || []).map((p) => ({ ...p, url: pub + p.storage_path })),
        notes: notes || [],
      })
    }

    if (action === 'add_note') {
      const { note_date, body: text, author_name } = body
      if (!note_date || !text) return bad(400, 'A date and note are required')
      await db.from('album_notes').insert({
        album_id: album.id, note_date, body: String(text).slice(0, 4000),
        author_name: (author_name || 'Guest').slice(0, 80),
      })
      return ok({ added: true })
    }

    if (action === 'add_photo') {
      // Client uploads the file to storage via a signed URL we hand back,
      // then calls this to register the row.
      const { storage_path, taken_on, caption, author_name, width, height } = body
      if (!storage_path || !taken_on) return bad(400, 'storage_path and taken_on required')
      await db.from('album_photos').insert({
        album_id: album.id, storage_path, taken_on,
        caption: (caption || '').slice(0, 500), author_name: (author_name || 'Guest').slice(0, 80),
        width: width || null, height: height || null,
      })
      return ok({ added: true })
    }

    if (action === 'sign_upload') {
      // Produce a one-time signed upload URL under the owner's folder.
      const ext = (body.ext || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
      const path = `${album.owner_id}/${album.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { data, error } = await db.storage.from('album-photos').createSignedUploadUrl(path)
      if (error) return bad(500, error.message)
      return ok({ path, token: data.token, signedUrl: data.signedUrl })
    }

    return bad(400, 'Unknown action')
  } catch (err) {
    console.error('album-public error', err)
    return bad(500, err.message)
  }
}
