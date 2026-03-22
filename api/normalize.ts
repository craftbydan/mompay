import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

/** Text-only fallback when OCR did not return a canonical merchant (rare). */
export interface MerchantNormalizeResult {
  canonical_name: string
  category: 'food' | 'grab' | 'transportation' | 'other'
  payment_method: 'qr' | 'card' | 'unknown'
}

const MODEL = process.env.OPENAI_NORMALIZE_MODEL ?? process.env.OPENAI_OCR_MODEL ?? 'gpt-5-nano'

const SCHEMA = {
  name: 'merchant_normalize',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['canonical_name', 'category', 'payment_method'],
    properties: {
      canonical_name: { type: 'string' },
      category: {
        type: 'string',
        enum: ['food', 'grab', 'transportation', 'other'],
      },
      payment_method: { type: 'string', enum: ['qr', 'card', 'unknown'] },
    },
  },
} as const

const PROMPT = `Normalize a payee string from a Thai payment slip into JSON only.
canonical_name: If the string is mostly Thai characters, output Thai only — do NOT translate to English. If it is English/Latin, output short English. No long sentences.
category: "grab" (Grab/แกร็บ), "food" (restaurant/cafe/bakery), "transportation" (non-Grab taxi/BTS/MRT/etc.), or "other".
payment_method: usually "qr" for app slips.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { raw_merchant_string } = req.body as { raw_merchant_string: string }

  if (!raw_merchant_string?.trim()) {
    return res.status(200).json({
      canonical_name: raw_merchant_string ?? '',
      category: 'other',
      payment_method: 'unknown',
    } satisfies MerchantNormalizeResult)
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  try {
    const openai = new OpenAI({ apiKey })

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2048,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: raw_merchant_string.trim() },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    })

    const choice = completion.choices?.[0]
    const msg = choice?.message
    const raw = typeof msg?.content === 'string' ? msg.content.trim() : ''
    if (typeof msg?.refusal === 'string' && msg.refusal) {
      throw new Error(`OpenAI refused: ${msg.refusal}`)
    }
    if (!raw) {
      throw new Error(`Empty model output (finish_reason=${choice?.finish_reason ?? 'unknown'})`)
    }

    let result: MerchantNormalizeResult
    try {
      result = JSON.parse(raw) as MerchantNormalizeResult
    } catch {
      throw new Error(`Invalid JSON from model: ${raw.slice(0, 160)}…`)
    }
    return res.status(200).json(result)
  } catch (err) {
    console.error('[normalize] error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Normalization failed' })
  }
}
