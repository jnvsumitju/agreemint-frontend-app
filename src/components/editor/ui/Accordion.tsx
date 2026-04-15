import { useState, useRef, useEffect, type ReactNode } from 'react'

interface AccordionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
  badge?: ReactNode
  className?: string
}

export function Accordion({ title, defaultOpen = true, children, badge, className }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0)

  useEffect(() => {
    if (!contentRef.current) return
    if (open) {
      setHeight(contentRef.current.scrollHeight)
      // After transition, set to auto so content can grow dynamically
      const timer = setTimeout(() => setHeight(undefined), 200)
      return () => clearTimeout(timer)
    } else {
      // Set explicit height first so transition works
      setHeight(contentRef.current.scrollHeight)
      requestAnimationFrame(() => setHeight(0))
    }
  }, [open])

  return (
    <div className={`border-b border-zinc-100 dark:border-zinc-800 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        aria-expanded={open}
      >
        <svg
          className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        {badge}
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height: height !== undefined ? `${height}px` : 'auto' }}
      >
        <div className={`px-3 pb-3 ${open ? '' : 'invisible'}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
