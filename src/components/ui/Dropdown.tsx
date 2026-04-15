import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'

/* ── Types ── */

export interface DropdownItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  onClick?: () => void
}

export interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  align?: 'left' | 'right'
  className?: string
}

/* ── Component ── */

export function Dropdown({ trigger, items, align = 'left', className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Actionable items only (skip dividers + disabled)
  const actionableItems = items.filter((i) => !i.divider && !i.disabled)

  // Keyboard navigation
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setOpen(true)
          setFocused(0)
        }
        return
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          setFocused(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocused((prev) => (prev + 1) % actionableItems.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocused((prev) => (prev - 1 + actionableItems.length) % actionableItems.length)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (focused >= 0 && focused < actionableItems.length) {
            actionableItems[focused].onClick?.()
            setOpen(false)
            setFocused(-1)
          }
          break
      }
    },
    [open, focused, actionableItems],
  )

  function handleItemClick(item: DropdownItem) {
    if (item.disabled) return
    item.onClick?.()
    setOpen(false)
    setFocused(-1)
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={ref} onKeyDown={onKeyDown}>
      {/* Trigger */}
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => { setOpen(!open); setFocused(-1) }}
      >
        {trigger}
      </div>

      {/* Menu */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute top-full z-50 mt-1 min-w-[180px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg
            dark:border-zinc-700 dark:bg-zinc-800
            animate-in fade-in zoom-in-95 duration-150
            ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item) => {
            if (item.divider) {
              return <div key={item.key} className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
            }

            const actionIdx = actionableItems.indexOf(item)
            const isFocused = actionIdx === focused

            return (
              <button
                key={item.key}
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors
                  ${item.disabled ? 'cursor-default opacity-40' : 'cursor-pointer'}
                  ${item.danger
                    ? `text-red-600 dark:text-red-400 ${isFocused ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-red-50 dark:hover:bg-red-900/20'}`
                    : `text-zinc-700 dark:text-zinc-200 ${isFocused ? 'bg-zinc-100 dark:bg-zinc-700' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700'}`
                  }
                `}
              >
                {item.icon && <span className="shrink-0 text-zinc-400">{item.icon}</span>}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
