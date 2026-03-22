import type { VercelRequest, VercelResponse } from '@vercel/node'
import OpenAI from 'openai'

/** Vision + classification in one call — tuned for Kasikorn K+ and SCB mobile slips. */
export type SlipBank = 'k_plus' | 'scb' | 'unknown'
export type SpendCategory = 'food' | 'grab' | 'transportation' | 'other'

export interface OcrResult {
  slip_bank: SlipBank
  date: string | null
  amount: number | null
  currency: string
  raw_merchant_string: string | null
  canonical_merchant: string | null
  spend_category: SpendCategory
  payment_method: 'qr' | 'card' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
}

const MODEL = process.env.OPENAI_OCR_MODEL ?? 'gpt-5-nano'

const OCR_JSON_SCHEMA = {
  name: 'thai_slip_extract',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'slip_bank',
      'date',
      'amount',
      'currency',
      'raw_merchant_string',
      'canonical_merchant',
      'spend_category',
      'payment_method',
      'confidence',
    ],
    properties: {
      slip_bank: { type: 'string', enum: ['k_plus', 'scb', 'unknown'] },
      date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      currency: { type: 'string' },
      raw_merchant_string: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      canonical_merchant: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      spend_category: {
        type: 'string',
        enum: ['food', 'grab', 'transportation', 'other'],
      },
      payment_method: { type: 'string', enum: ['qr', 'card', 'unknown'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  },
} as const

const SYSTEM_PROMPT = `You read Thai mobile-banking payment confirmation screenshots. Only two layouts are in scope right now; anything else still gets the same JSON shape.

Layouts:
A) Kasikorn K+ (K Plus): K+ logo, green/red Kasikorn cues, success text like "ชำระเงินสำเร็จ", sender block then receiver (shop) with optional company line.
B) SCB: SCB / ไทยพาณิชย์, success "จ่ายเงินสำเร็จ", sections "จาก" (from) and "ไปยัง" (to).

IGNORE — never use these for raw_merchant_string, canonical_merchant, or category (they are not the payee):
- Kasikorn premium / marketing watermarks and slogans, including English text like "THE WISDOM", "WISDOM", prestige tier labels, decorative English phrases on the slip background or header/footer.
- Any bank tagline, ad copy, or decorative text that is not the actual counterparty of the transfer.
- The payer/sender name block (e.g. "นาย …" / account xxx) — that is the user, not the merchant.
- Generic bank names (กสิกรไทย, Kasikorn, SCB, K+, etc.) unless the bank itself is literally the payee of the transaction.

READ — use only these for merchant fields and classification:
- The actual recipient / payee of the payment: shop name, branch line, บจก. company name under the receiver, PromptPay name, "ไปยัง" target name, or the merchant block under the arrow toward the receiver on K+ slips.
- Amount lines: จำนวน / จำนวนเงิน / fee lines (use the main paid amount).
- Transaction date/time shown for the payment (not unrelated print dates).

SCB / Grab (critical — read Thai carefully):
- On SCB slips the payee is the line under "ไปยัง" (to), NOT "จาก" (from).
- Grab ride payments often show exactly: แกร็บแท็กซี่ (ประเทศไทย) or similar. Copy Thai text character-for-character.
- แกร็บ = Grab (brand). แท็กซี่ = taxi. เบเกอรี่ = bakery. Do NOT confuse these: แกร็บแท็กซี่ is Grab Taxi, NOT a bakery. Never output เบเกอรี่ unless the slip literally says bakery.
- If you see แกร็บ or "Grab" or GrabTaxi in the payee → spend_category MUST be "grab", never "food".

Task: output one JSON object (no markdown, no prose) matching the schema.

slip_bank: "k_plus" if Kasikorn/K+/กสิกร dominates; "scb" if SCB/Siam Commercial dominates; else "unknown".

raw_merchant_string: Payee/recipient exactly as shown (Thai/English) from the RECEIVER section only — never "THE WISDOM" or other watermarks. Prefer the consumer-facing merchant line (e.g. shop + branch), not the payer. Include company suffix in the same string if visible (e.g. บจก.).

canonical_merchant: Must match what is on the slip. If the receiver shows Thai (e.g. สมิชเชิล-วันโอวัน and บจก. สมิชเชิล), canonical_merchant MUST stay in Thai — use the main shop/branch line as printed, or "shop · บจก." joined briefly. NEVER output romanized guesses (no "Smichchel", "Smith", etc.) when Thai is visible. English/Latin only when the slip shows English only.

spend_category (pick exactly one):
- "grab" if payee is any Grab product (แกร็บ, แกร็บแท็กซี่, Grab, GrabTaxi, GrabFood, GrabPay, etc.). This overrides food if both could be guessed wrong.
- "food" if clearly restaurant, cafe, bakery, coffee, or food retail chain (e.g. สมิชเชิล) — but NOT when the payee is Grab (see above).
- "transportation" for non-Grab transit/taxi/mobility (Bolt, แท็กซี่ alone without แกร็บ, BTS, MRT, bus). If แกร็บ or Grab appears → "grab", not this.
- "other" for person-to-person, bank fees, government, utilities, generic shopping, or unclear.

date: YYYY-MM-DD. Thai Buddhist Era: subtract 543 from พ.ศ. year. Two-digit BE years like 69 → 2026. Thai month abbrevs: ม.ค.01 ก.พ.02 มี.ค.03 เม.ย.04 พ.ค.05 มิ.ย.06 ก.ค.07 ส.ค.08 ก.ย.09 ต.ค.10 พ.ย.11 ธ.ค.12. Use transaction datetime on the slip. Null only if unreadable.

amount: numeric total paid (จำนวน / จำนวนเงิน). Null if unreadable. currency usually "THB".

payment_method: "qr" for these in-app transfer slips; "card" only for true card POS slips; else "unknown".

confidence: "high" if date+amount+payee are clear; "medium" if one is weak; "low" if multiple issues or blur.`

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Fixes common vision errors, e.g. แกร็บแท็กซี่ misread as แทร็บเบเกอรี่. */
function applyPostParseOcrFixes(parsed: Record<string, unknown>): void {
  const raw = typeof parsed.raw_merchant_string === 'string' ? parsed.raw_merchant_string : ''
  const canon = typeof parsed.canonical_merchant === 'string' ? parsed.canonical_merchant : ''

  const bakeryGrabHallucination =
    /แทร็บเบเกอรี่|แทรบเบเกอรี่|แทร็บ\s*เบเกอรี่|แทร็บ.*เบเกอรี่/i
  if (bakeryGrabHallucination.test(raw) || bakeryGrabHallucination.test(canon)) {
    parsed.raw_merchant_string = 'แกร็บแท็กซี่ (ประเทศไทย)'
    parsed.canonical_merchant = 'แกร็บแท็กซี่ (ประเทศไทย)'
    parsed.spend_category = 'grab'
    return
  }

  const bundle = `${raw} ${canon}`
  if (
    /แกร็บ/i.test(bundle) ||
    /\bGrab\b/i.test(bundle) ||
    /GrabTaxi|GrabPay|GrabFood|GrabMart|แกร็บแท็กซี่|แกร็บฟู้ด|แกร็บเพย์/i.test(bundle)
  ) {
    parsed.spend_category = 'grab'
  }
}

/** If model returned Latin canonical but raw_merchant_string is Thai, copy Thai into canonical. */
function alignCanonicalToThaiRaw(parsed: Record<string, unknown>): void {
  const raw = typeof parsed.raw_merchant_string === 'string' ? parsed.raw_merchant_string.trim() : ''
  const canon = typeof parsed.canonical_merchant === 'string' ? parsed.canonical_merchant.trim() : ''
  if (!raw || !/[\u0E00-\u0E7F]/.test(raw)) return
  if (canon && /[\u0E00-\u0E7F]/.test(canon)) return
  if (canon && !/[\u0E00-\u0E7F]/.test(canon)) {
    const firstLine = raw.split(/\n/).map(l => l.trim()).find(Boolean) ?? raw
    parsed.canonical_merchant = firstLine
  }
}

function coerceOcr(parsed: Record<string, unknown>): OcrResult {
  const sb = pickEnum(parsed.slip_bank, ['k_plus', 'scb', 'unknown'] as const, 'unknown')
  const sc = pickEnum(parsed.spend_category, ['food', 'grab', 'transportation', 'other'] as const, 'other')
  const pay = pickEnum(parsed.payment_method, ['qr', 'card', 'unknown'] as const, 'unknown')
  const co = pickEnum(parsed.confidence, ['high', 'medium', 'low'] as const, 'medium')

  return {
    slip_bank: sb,
    date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
    amount: typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? parsed.amount : null,
    currency: typeof parsed.currency === 'string' && parsed.currency.trim() ? parsed.currency.trim() : 'THB',
    raw_merchant_string: typeof parsed.raw_merchant_string === 'string' ? parsed.raw_merchant_string : null,
    canonical_merchant: typeof parsed.canonical_merchant === 'string' ? parsed.canonical_merchant : null,
    spend_category: sc,
    payment_method: pay,
    confidence: co,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { image_url } = req.body as { image_url: string }

  if (!image_url) return res.status(400).json({ error: 'image_url is required' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' })

  try {
    const openai = new OpenAI({ apiKey })

    const completion = await openai.chat.completions.create({
      model: MODEL,
      // Reasoning models consume output budget first; too low → empty content and JSON parse errors
      max_completion_tokens: 4096,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image_url, detail: 'high' } },
            {
              type: 'text',
              text: 'Extract per schema. SCB: payee is under ไปยัง only. แกร็บแท็กซี่ is Grab Taxi (category grab), not bakery. Ignore watermarks; merchant = receiver only.',
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: OCR_JSON_SCHEMA,
      },
    })

    const choice = completion.choices?.[0]
    const msg = choice?.message
    const rawText = typeof msg?.content === 'string' ? msg.content.trim() : ''
    const refusal = typeof msg?.refusal === 'string' ? msg.refusal : ''

    if (refusal) throw new Error(`OpenAI refused: ${refusal}`)
    if (!rawText) {
      const fr = choice?.finish_reason ?? 'unknown'
      throw new Error(
        `Empty model output (finish_reason=${fr}). Try raising max_completion_tokens or lowering load.`,
      )
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>
    } catch {
      throw new Error(`Invalid JSON from model: ${rawText.slice(0, 200)}…`)
    }
    applyPostParseOcrFixes(parsed)
    alignCanonicalToThaiRaw(parsed)
    const extracted = coerceOcr(parsed)

    return res.status(200).json(extracted)
  } catch (err) {
    console.error('[ocr] error:', err)
    return res.status(500).json({ error: err instanceof Error ? err.message : 'OCR failed' })
  }
}
