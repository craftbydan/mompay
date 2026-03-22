import type { ExpenseCategory } from '../types'

const DISPLAY: Record<
  ExpenseCategory,
  { emoji: string; label: string }
> = {
  food: { emoji: '🍜', label: 'Food' },
  grab: { emoji: '🚕', label: 'Grab' },
  transportation: { emoji: '🚌', label: 'Transport' },
  other: { emoji: '📎', label: 'Other' },
}

function normalizeCategory(raw: string): ExpenseCategory {
  if (raw === 'food' || raw === 'grab' || raw === 'transportation' || raw === 'other') return raw
  return 'other'
}

type Props = {
  category: string
  /** Mom report: draw attention to “Other” (review) with warmer styling */
  otherEmphasis?: boolean
  className?: string
}

export function CategoryPill({ category, otherEmphasis, className }: Props) {
  const cat = normalizeCategory(category)
  const { emoji, label } = DISPLAY[cat]
  const reviewOther = cat === 'other' && otherEmphasis

  return (
    <span
      className={[
        'category-pill',
        `category-pill--${cat}`,
        reviewOther ? 'category-pill--other-emphasis' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="category-pill-emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="category-pill-label">{label}</span>
    </span>
  )
}
