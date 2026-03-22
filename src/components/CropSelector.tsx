import { useRef, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { RegionField } from '../../api/ocr-region'

interface Rect { x: number; y: number; w: number; h: number }

interface CropSelectorProps {
  imageUrl: string
  expenseId: string
  onDone: () => void
}

const FIELD_LABELS: Record<RegionField, string> = {
  merchant: 'merchant name',
  amount: 'amount',
  date: 'date',
}

export function CropSelector({ imageUrl, expenseId, onDone }: CropSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const imgRef       = useRef<HTMLImageElement>(null)

  const [dragging, setDragging]   = useState(false)
  const [start, setStart]         = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect]           = useState<Rect | null>(null)
  const [cropped, setCropped]     = useState<string | null>(null)   // base64 of selected region
  const [applying, setApplying]   = useState<RegionField | null>(null)
  const [done, setDone]           = useState<RegionField | null>(null)
  const [error, setError]         = useState<string | null>(null)

  // Draw selection rectangle on canvas
  const drawRect = useCallback((r: Rect | null) => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    canvas.width  = img.clientWidth
    canvas.height = img.clientHeight
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!r || r.w === 0 || r.h === 0) return

    // Dim everything outside selection
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.clearRect(r.x, r.y, r.w, r.h)

    // Selection border
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.strokeRect(r.x, r.y, r.w, r.h)

    // Corner handles
    const h = 8
    ctx.fillStyle = '#3b82f6'
    const corners = [
      [r.x, r.y], [r.x + r.w - h, r.y],
      [r.x, r.y + r.h - h], [r.x + r.w - h, r.y + r.h - h],
    ]
    corners.forEach(([cx, cy]) => ctx.fillRect(cx, cy, h, h))
  }, [])

  useEffect(() => { drawRect(rect) }, [rect, drawRect])

  function getPos(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current!
    const bounds = canvas.getBoundingClientRect()
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (cropped) return   // already have a selection, reset first
    e.preventDefault()
    const pos = getPos(e)
    setStart(pos)
    setRect(null)
    setDragging(true)
    setDone(null)
    setError(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !start) return
    const pos = getPos(e)
    setRect({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    })
  }

  function onMouseUp(e: React.MouseEvent) {
    if (!dragging || !start) return
    setDragging(false)
    const pos = getPos(e)
    const r = {
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    }
    if (r.w < 10 || r.h < 10) {
      setRect(null)
      return
    }
    setRect(r)
    cropImage(r)
  }

  function cropImage(r: Rect) {
    const img = imgRef.current!
    const scaleX = img.naturalWidth  / img.clientWidth
    const scaleY = img.naturalHeight / img.clientHeight
    const tmp = document.createElement('canvas')
    tmp.width  = Math.round(r.w * scaleX)
    tmp.height = Math.round(r.h * scaleY)
    const ctx = tmp.getContext('2d')!
    ctx.drawImage(img, r.x * scaleX, r.y * scaleY, tmp.width, tmp.height, 0, 0, tmp.width, tmp.height)
    setCropped(tmp.toDataURL('image/jpeg', 0.92))
  }

  function reset() {
    setRect(null)
    setCropped(null)
    setDone(null)
    setError(null)
    drawRect(null)
  }

  async function applyField(field: RegionField) {
    if (!cropped) return
    setApplying(field)
    setError(null)
    try {
      const res = await fetch('/api/ocr-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: cropped, field }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'OCR region failed')
      const { value } = json as { value: string | null }
      if (!value) throw new Error('Could not read that region')

      if (field === 'merchant') {
        // Find or create merchant, then link
        const trimmed = value.trim()
        const { data: existing } = await supabase
          .from('merchants').select('id').ilike('canonical_name', trimmed).limit(1).single()
        if (existing) {
          await supabase.from('expenses').update({ merchant_id: existing.id, needs_review: true }).eq('id', expenseId)
        } else {
          const { data: created } = await supabase
            .from('merchants')
            .insert({ canonical_name: trimmed, category: 'other', payment_method: 'unknown' })
            .select('id').single()
          if (created) {
            await supabase.from('expenses')
              .update({ merchant_id: created.id, needs_review: true, auto_classified: false })
              .eq('id', expenseId)
          }
        }
        // Update raw OCR string too
        await supabase.from('ocr_raw')
          .update({ raw_merchant_string: trimmed })
          .eq('expense_id', expenseId)
      } else if (field === 'amount') {
        const num = parseFloat(value.replace(/[^0-9.]/g, ''))
        if (!isNaN(num)) await supabase.from('expenses').update({ amount: num }).eq('id', expenseId)
        else throw new Error(`Couldn't parse amount: "${value}"`)
      } else if (field === 'date') {
        await supabase.from('expenses').update({ date: value }).eq('id', expenseId)
      }

      setDone(field)
      setTimeout(() => { onDone(); reset() }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="crop-selector" ref={containerRef}>
      <div className="crop-img-wrap">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="receipt"
          className="crop-img"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className={`crop-canvas ${cropped ? '' : 'crop-canvas-active'}`}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>

      <div className="crop-toolbar">
        {!cropped ? (
          <p className="crop-hint">
            {dragging ? 'release to select' : 'drag to select a region'}
          </p>
        ) : (
          <>
            <p className="crop-hint">what is this?</p>
            <div className="crop-field-btns">
              {(['merchant', 'amount', 'date'] as RegionField[]).map(f => (
                <button
                  key={f}
                  className={`crop-field-btn ${done === f ? 'done' : ''}`}
                  onClick={() => applyField(f)}
                  disabled={applying !== null}
                >
                  {applying === f ? '…' : done === f ? `✓ ${FIELD_LABELS[f]}` : FIELD_LABELS[f]}
                </button>
              ))}
            </div>
            {error && <p className="crop-error">{error}</p>}
            <button className="btn-ghost crop-reset-btn" onClick={reset}>
              redraw
            </button>
          </>
        )}
      </div>
    </div>
  )
}
