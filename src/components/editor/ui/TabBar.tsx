import { useRef, useEffect, useState, type ReactNode } from 'react'

interface Tab {
  key: string
  label: string
  icon?: ReactNode
  badge?: number
}

interface TabBarProps {
  tabs: Tab[]
  activeKey: string
  onChange: (key: string) => void
  size?: 'sm' | 'md'
}

export function TabBar({ tabs, activeKey, onChange, size = 'sm' }: TabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  // Update sliding indicator position
  useEffect(() => {
    if (!containerRef.current) return
    const activeTab = containerRef.current.querySelector<HTMLButtonElement>(`[data-tab-key="${activeKey}"]`)
    if (activeTab) {
      const containerRect = containerRef.current.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      setIndicator({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      })
    }
  }, [activeKey])

  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const py = size === 'sm' ? 'py-1.5' : 'py-2'

  return (
    <div className="relative border-b border-zinc-100 dark:border-zinc-800">
      <div
        ref={containerRef}
        className="flex overflow-x-auto scrollbar-none"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey
          return (
            <button
              key={tab.key}
              data-tab-key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.key)}
              className={`relative flex shrink-0 items-center gap-1 px-3 ${py} ${textSize} font-medium transition-colors whitespace-nowrap
                ${isActive
                  ? 'text-violet-700 dark:text-violet-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Sliding indicator */}
      <div
        className="absolute bottom-0 h-0.5 bg-violet-600 transition-all duration-200 ease-out dark:bg-violet-400"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  )
}
