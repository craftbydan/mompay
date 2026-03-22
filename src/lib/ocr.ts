import type { OcrResult } from '../../api/ocr'

export type { OcrResult }

const MAX_RETRIES = 3

export async function runOcr(imageUrl: string): Promise<OcrResult> {
  let lastError: Error = new Error('OCR failed')

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      })

      if (!res.ok) {
        const text = await res.text()
        let error = `HTTP ${res.status}`
        if (text.trim()) {
          try {
            error = (JSON.parse(text) as { error?: string }).error ?? text.slice(0, 300)
          } catch {
            error = text.slice(0, 300)
          }
        }
        lastError = new Error(error)

        // Retry on 429 (rate limit) or 503 (overload) with backoff
        if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 4000))
          continue
        }
        throw lastError
      }

      const body = await res.text()
      if (!body.trim()) throw new Error('OCR returned an empty response')
      try {
        return JSON.parse(body) as OcrResult
      } catch {
        throw new Error(`OCR response was not JSON: ${body.slice(0, 200)}…`)
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 4000))
      }
    }
  }

  throw lastError
}
