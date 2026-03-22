import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

export type RegionField = 'merchant' | 'amount' | 'date'

export interface OcrRegionResult {
  value: string | null
}

const MODEL = process.env.OPENAI_OCR_MODEL ?? 'gpt-5-nano'

const FIELD_PROMPTS: Record<RegionField, string> = {
  merchant: `Cropped Thai payment slip region. Return ONLY the merchant/payee/recipient name as plain text. If unclear, return the JSON string null.`,
  amount: `Cropped Thai payment slip region. Return ONLY the number (e.g. 125.50), no currency. If unclear, null.`,
  date: `Cropped Thai payment slip region. Return ONLY YYYY-MM-DD. B.E. year minus 543. Thai months: ม.ค.01 … ธ.ค.12. If unclear, null.`,
}

const REGION_SCHEMA = {
  name: 'region_value',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: {
      value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
  },
} as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { image_base64, field } = req.body as { image_base64: string; field: RegionField }

  if (!image_base64) return res.status(400).json({ error: 'image_base64 is required' })
  if (!field || !FIELD_PROMPTS[field]) {
    return res.status(400).json({ error: 'field must be merchant, amount, or date' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  const url = image_base64.startsWith('data:') ? image_base64 : `data:image/jpeg;base64,${image_base64}`

  try {
    const openai = new OpenAI({ apiKey })

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1024,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url, detail: 'low' } },
            { type: 'text', text: FIELD_PROMPTS[field] },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: REGION_SCHEMA },
    })

    const choice = completion.choices?.[0]
    const msg = choice?.message
    const raw = typeof msg?.content === 'string' ? msg.content.trim() : ''
    if (!raw) return res.status(200).json({ value: null })

    let parsed: { value: string | null }
    try {
      parsed = JSON.parse(raw) as { value: string | null }
    } catch {
      return res.status(200).json({ value: null })
    }
    const value = parsed.value === null || parsed.value === undefined
      ? null
      : String(parsed.value).trim() || null

    return res.status(200).json({ value: value === 'null' ? null : value })
  } catch (err) {
    console.error('[ocr-region] error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'OCR region failed' })
  }
}
