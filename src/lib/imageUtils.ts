// Resize + compress an image to a safe size for OCR API calls.
// iPhone photos are 4-8 MB; pixtral works fine at 1600px max.
const MAX_PX = 1600
const QUALITY = 0.85

export function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      let { width, height } = img
      if (width > MAX_PX || height > MAX_PX) {
        if (width > height) {
          height = Math.round((height * MAX_PX) / width)
          width = MAX_PX
        } else {
          width = Math.round((width * MAX_PX) / height)
          height = MAX_PX
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
      const base64 = dataUrl.split(',')[1]
      resolve({ base64, mimeType: 'image/jpeg' })
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image for compression'))
    }

    img.src = objectUrl
  })
}
