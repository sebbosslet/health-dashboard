import { supabase } from '../lib/supabase'

export async function listAlbums(userId) {
  const { data, error } = await supabase.from('albums').select('*').eq('owner_id', userId).order('start_date', { ascending: false })
  if (error) { console.error(error); return [] }
  return data || []
}

export async function createAlbum(userId, { title, subtitle, start_date, end_date }) {
  const { data, error } = await supabase.from('albums')
    .insert({ owner_id: userId, title, subtitle: subtitle || null, start_date: start_date || null, end_date: end_date || null })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteAlbum(id) {
  const { error } = await supabase.from('albums').delete().eq('id', id)
  if (error) throw error
}

const pub = (path) => `${supabase.supabaseUrl}/storage/v1/object/public/album-photos/${path}`

export async function ownerUploadPhoto(userId, albumId, file, { taken_on, caption }) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
  const path = `${userId}/${albumId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await supabase.storage.from('album-photos').upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw up.error
  const { error } = await supabase.from('album_photos').insert({
    album_id: albumId, storage_path: path, taken_on, caption: caption || null, author_name: 'You',
  })
  if (error) throw error
  return pub(path)
}

export async function fetchAlbum(albumId) {
  const [{ data: album }, { data: photos }, { data: notes }] = await Promise.all([
    supabase.from('albums').select('*').eq('id', albumId).single(),
    supabase.from('album_photos').select('*').eq('album_id', albumId).order('taken_on').order('sort'),
    supabase.from('album_notes').select('*').eq('album_id', albumId).order('note_date').order('created_at'),
  ])
  return {
    album,
    photos: (photos || []).map((p) => ({ ...p, url: pub(p.storage_path) })),
    notes: notes || [],
  }
}

export async function ownerAddNote(albumId, { note_date, body }) {
  const { error } = await supabase.from('album_notes').insert({ album_id: albumId, note_date, body, author_name: 'You' })
  if (error) throw error
}
export async function deletePhoto(id) { await supabase.from('album_photos').delete().eq('id', id) }
export async function deleteNote(id) { await supabase.from('album_notes').delete().eq('id', id) }
export async function updatePhoto(id, patch) { await supabase.from('album_photos').update(patch).eq('id', id) }

export function shareLink(token) { return `${window.location.origin}/trip/${token}` }
