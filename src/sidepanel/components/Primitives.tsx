import type { ReactNode, MouseEvent } from 'react'

/**
 * A single stat cell for StatsBar. Hoisted to module scope (formerly an inner
 * component defined inside StatsBar's render) so it keeps a stable identity and
 * doesn't unmount/remount on every StatsBar re-render.
 */
export function StatsCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[16px] font-bold text-accent leading-none font-serif">{value}</span>
      <span className="text-[9px] text-ink-faint mt-1 uppercase tracking-wide">{label}</span>
    </div>
  )
}

/**
 * Small icon-only button with shared a11y (aria-label + title). Used for the
 * hover-action buttons on list rows.
 */
export function IconButton({
  label,
  onClick,
  children,
  danger,
  className = '',
}: {
  label: string
  onClick: (e: MouseEvent) => void
  children: ReactNode
  danger?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        danger
          ? `text-danger hover:bg-danger-soft/50 ${className}`
          : `text-ink-soft hover:bg-surface-muted hover:text-ink ${className}`
      }
    >
      {children}
    </button>
  )
}

export interface RowAction {
  label: string
  onClick: (e: MouseEvent) => void
  icon: ReactNode
  danger?: boolean
}

/**
 * A list row with hover-revealed action buttons. Captures the
 * "title/subtitle on the left, opacity-0 group-hover:opacity-100 actions on the
 * right" chrome repeated across VocabView / TemplatesView / GlossaryView /
 * SentencesView / Highlights / Library. The row itself is clickable when
 * `onClick` is provided.
 */
export function Row({
  title,
  subtitle,
  onClick,
  actions = [],
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClick?: (e: MouseEvent) => void
  actions?: RowAction[]
  children?: ReactNode
}) {
  return (
    <div
      className={`group row flex items-center gap-2 px-3 py-2 border-b border-line ${onClick ? 'cursor-pointer hover:bg-surface-muted/50' : ''}`}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-ink-faint">{subtitle}</div>}
      </div>
      {children}
      {actions.length > 0 && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions.map((a, i) => (
            <IconButton
              key={i}
              label={a.label}
              onClick={a.onClick}
              danger={a.danger}
              className="p-1"
            >
              {a.icon}
            </IconButton>
          ))}
        </div>
      )}
    </div>
  )
}
