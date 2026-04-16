import { IMG_MAX_PX, IMG_QUALITY } from './constants'

/**
 * Compress an image File to base64 JPEG.
 * Returns { base64, mimeType }
 */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > IMG_MAX_PX || h > IMG_MAX_PX) {
        if (w > h) { h = Math.round(h * IMG_MAX_PX / w); w = IMG_MAX_PX }
        else { w = Math.round(w * IMG_MAX_PX / h); h = IMG_MAX_PX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', IMG_QUALITY)
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
    }
    img.onerror = reject
    img.src = url
  })
}
