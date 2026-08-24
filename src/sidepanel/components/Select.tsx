import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckIcon } from '../../shared/icons'

// ---------------------------------------------------------------------------
// Select — 自绘下拉框（替代原生 <select>）。
// 原生 select 的弹出层由 OS 渲染，无法跟随「精装手册」设计系统（暖色纸面、
// 圆角、边框、暗色主题），因此用 button + listbox 自绘。键盘语义对齐原生：
// Enter/Space/ArrowDown 展开，↑/↓ 移动，Enter 选中，Esc/Tab 关闭。
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  value,
  options,
  onChange,
  className = '',
  size = 'md',
  id,
  ariaLabel,
  disabled = false,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** 附加到触发按钮的类（如 w-full、w-auto flex-shrink-0）。 */
  className?: string
  size?: 'md' | 'sm'
  id?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [flipUp, setFlipUp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const selected = options[selectedIdx]

  // 关闭时重置键盘高亮到当前选中项，与原生 select 行为一致。
  useEffect(() => {
    if (!open) setActiveIdx(selectedIdx)
  }, [open, selectedIdx])

  // 展开方向：下方空间不足且上方更充裕时向上弹。useLayoutEffect 保证在
  // 首帧绘制前定方向，避免先向下再跳转的闪烁。
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    setFlipUp(below < 240 && rect.top > below)
  }, [open])

  // 点击外部 / Esc 关闭（Esc 在 onKeyDown 里也处理一次，这里兜底焦点
  // 不在控件上的场景）。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 键盘高亮项滚入可视区。
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  const commit = (idx: number) => {
    const opt = options[idx]
    if (!opt) return
    onChange(opt.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(selectedIdx)
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIdx(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIdx(options.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        commit(activeIdx)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  const fieldCls = size === 'sm' ? 'field-sm' : 'field'
  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return
          setActiveIdx(selectedIdx)
          setOpen((o) => !o)
        }}
        onKeyDown={onKeyDown}
        className={`${fieldCls} w-full text-left flex items-center justify-between gap-2 cursor-pointer ${
          open ? 'border-accent bg-surface ring-2 ring-accent-soft' : ''
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <span className="truncate">{selected ? selected.label : ''}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`flex-shrink-0 w-3.5 h-3.5 text-ink-faint transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute left-0 right-0 z-40 min-w-full py-1 bg-surface border border-line rounded-lg shadow-lg max-h-60 overflow-y-auto lector-anim-pop ${
            flipUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value
            const isActive = i === activeIdx
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => commit(i)}
                onMouseMove={() => setActiveIdx(i)}
                className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-left ${
                  size === 'sm' ? 'text-meta' : 'text-[13px]'
                } ${
                  isActive
                    ? 'bg-accent-softer text-accent'
                    : isSelected
                      ? 'text-ink'
                      : 'text-ink-soft hover:bg-surface-muted'
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {isSelected && (
                  <CheckIcon size={13} className="flex-shrink-0 text-accent" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
