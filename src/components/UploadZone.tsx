import { useRef, useState, useCallback, type DragEvent, type ChangeEvent, type KeyboardEvent } from 'react'

export type UploadStatus =
  | 'queued'
  | 'creating'
  | 'uploading'
  | 'ocr'
  | 'normalizing'
  | 'done'
  | 'error'

export interface UploadItem {
  key: string         // stable local key (not expense_id)
  file: File
  preview: string     // object URL
  status: UploadStatus
  error?: string
  expenseId?: string
}

interface UploadZoneProps {
  items: UploadItem[]
  onFiles: (files: File[]) => void
  disabled?: boolean
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: 'queued',
  creating: 'creating…',
  uploading: 'uploading…',
  ocr: 'reading receipt…',
  normalizing: 'identifying merchant…',
  done: 'done',
  error: 'error',
}

export function UploadZone({ items, onFiles, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const acceptFiles = useCallback(
    (files: FileList | null) => {
      if (!files || disabled) return
      const images = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (images.length) onFiles(images)
    },
    [onFiles, disabled],
  )

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    acceptFiles(e.dataTransfer.files)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave() {
    setDragging(false)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    acceptFiles(e.target.files)
    e.target.value = ''
  }

  function handleZoneKeyDown(e: KeyboardEvent) {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      inputRef.current?.click()
    }
  }

  const doneCount = items.filter(i => i.status === 'done').length
  const errorCount = items.filter(i => i.status === 'error').length
  const processing = items.some(
    i => i.status !== 'queued' && i.status !== 'done' && i.status !== 'error',
  )

  return (
    <div className="upload-section">
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={dragging ? 'Drop images to add receipts' : 'Upload receipt images. Press to choose files.'}
        aria-disabled={disabled}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={handleZoneKeyDown}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={handleChange}
        />
        <span className="upload-icon">↑</span>
        <p className="upload-label">
          {dragging ? 'drop to add' : 'drag & drop receipts or click to browse'}
        </p>
        <p className="upload-hint">JPG, PNG, HEIC · up to 50 images</p>
      </div>

      {items.length > 0 && (
        <div className="upload-list">
          <div className="upload-list-header">
            <span className="upload-list-count">
              {items.length} file{items.length !== 1 ? 's' : ''}
            </span>
            {processing && <span className="upload-list-status processing">processing…</span>}
            {!processing && doneCount > 0 && (
              <span className="upload-list-status done">
                {doneCount} done{errorCount > 0 ? `, ${errorCount} failed` : ''}
              </span>
            )}
          </div>
          <div className="upload-items">
            {items.map(item => (
              <div key={item.key} className={`upload-item upload-item-${item.status}`}>
                <img src={item.preview} alt="" className="upload-thumb" />
                <div className="upload-item-info">
                  <span className="upload-item-name">{item.file.name}</span>
                  {item.error && <span className="upload-item-error">{item.error}</span>}
                </div>
                <span className="upload-item-badge">{STATUS_LABEL[item.status]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
