import { useState, useRef, type ReactNode } from 'react'

interface TooltipProps {
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  children: ReactNode
  shortcut?: string
}

export function Tooltip({ content, position = 'bottom', delay = 400, shortcut, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function show() {
    timeoutRef.current = setTimeout(() => setVisible(true), delay)
  }

  function hide() {
    clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute z-[9999] whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg
            dark:bg-zinc-100 dark:text-zinc-900
            animate-in fade-in duration-150
            ${positionClasses[position]}`}
        >
          <span>{content}</span>
          {shortcut && (
            <kbd className="ml-1.5 rounded border border-zinc-700 px-1 py-0.5 text-[9px] text-zinc-400 dark:border-zinc-300 dark:text-zinc-500">
              {shortcut}
            </kbd>
          )}
        </div>
      )}
    </div>
  )
}
