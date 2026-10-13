// Read the capture date from a JPEG's EXIF without any dependency.
// Scans the APP1/Exif block for DateTimeOriginal (tag 0x9003), falling
// back to DateTime (0x0132). Returns 'YYYY-MM-DD' or null.
export async function exifDate(file) {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
    if (buf.getUint16(0) !== 0xFFD8) return fileDate(file) // not a JPEG
    let off = 2
    while (off < buf.byteLength - 4) {
      if (buf.getUint8(off) !== 0xFF) break
      const marker = buf.getUint8(off + 1)
      const size = buf.getUint16(off + 2)
      if (marker === 0xE1) { // APP1 (Exif)
        const d = parseExif(buf, off + 4, size - 2)
        if (d) return d
        break
      }
      off += 2 + size
    }
  } catch { /* fall through */ }
  return fileDate(file)
}

function parseExif(buf, start, len) {
  // "Exif\0\0"
  if (buf.getUint32(start) !== 0x45786966) return null
  let p = start + 6
  const little = buf.getUint16(p) === 0x4949
  const u16 = (o) => buf.getUint16(o, little)
  const u32 = (o) => buf.getUint32(o, little)
  const tiff = p
  const ifd0 = tiff + u32(tiff + 4)
  const readIFD = (base) => {
    const n = u16(base)
    let exifIFD = null
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12
      const tag = u16(e)
      if (tag === 0x8769) exifIFD = tiff + u32(e + 8)        // ExifOffset
      if (tag === 0x0132 || tag === 0x9003 || tag === 0x9004) {
        const strOff = tiff + u32(e + 8)
        const s = readAscii(buf, strOff, 19)
        if (s && /^\d{4}:\d{2}:\d{2}/.test(s)) return { date: s.slice(0, 10).replace(/:/g, '-'), tag }
      }
    }
    return { exifIFD }
  }
  const r0 = readIFD(ifd0)
  // DateTimeOriginal lives in the Exif sub-IFD; prefer it
  if (r0.exifIFD) {
    const r1 = readIFD(r0.exifIFD)
    if (r1.date) return r1.date
  }
  if (r0.date) return r0.date
  return null
}

function readAscii(buf, off, n) {
  let s = ''
  for (let i = 0; i < n; i++) { const c = buf.getUint8(off + i); if (c === 0) break; s += String.fromCharCode(c) }
  return s
}

function fileDate(file) {
  if (file.lastModified) return new Date(file.lastModified).toISOString().slice(0, 10)
  return null
}
