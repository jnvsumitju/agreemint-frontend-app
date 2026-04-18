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
  /**
   * When true, each tab renders only its icon. The label is moved into the
   * button's accessibility label + tooltip so screen-reader users still
   * hear it. Used by {@code PropertiesPanel} when the user drags the
   * right sidebar below the "labels fit" threshold.
   */
  iconOnly?: boolean
}

export function TabBar({ tabs, activeKey, onChange, size = 'sm', iconOnly = false }: TabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  /**
   * Measure the active tab's position + width so the sliding indicator
   * underline lines up with it. Re-runs when:
   *  - the active tab changes (obvious)
   *  - iconOnly toggles (button widths shrink/grow)
   *  - the container itself resizes (user drags the panel wider/narrower)
   * The ResizeObserver covers the drag-resize case that plain deps miss.
   */
  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const measure = () => {
      const activeTab = container.querySelector<HTMLButtonElement>(`[data-tab-key="${activeKey}"]`)
      if (!activeTab) return
      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      setIndicator({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => ro.disconnect()
  }, [activeKey, iconOnly])

  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const py = size === 'sm' ? 'py-1.5' : 'py-2'

  return (
    <div className="relative border-b border-zinc-100 dark:border-zinc-800">
      <div
        ref={containerRef}
        /*
          In icon-only mode the tabs share the available width evenly so
          they don't clump at the left. With labels on, tabs keep natural
          widths and the container scrolls horizontally if needed.
        */
        className={iconOnly ? 'flex w-full' : 'flex overflow-x-auto scrollbar-none'}
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
              aria-label={iconOnly ? tab.label : undefined}
              title={iconOnly ? tab.label : undefined}
              onClick={() => onChange(tab.key)}
              className={`relative flex items-center gap-1 ${py} ${textSize} font-medium transition-colors whitespace-nowrap
                ${iconOnly ? 'flex-1 justify-center px-1' : 'shrink-0 px-3'}
                ${isActive
                  ? 'text-violet-700 dark:text-violet-400'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              {!iconOnly && tab.label}
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
