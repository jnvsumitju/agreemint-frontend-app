import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PresenceUser } from '../../stores/presenceStore'

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/**
 * Small avatar chip pinned at the top-right corner of an element that
 * another user has selected / is editing. On hover it pops a tooltip
 * (portaled to `body` so it escapes the canvas `overflow:hidden` and the
 * element's transform context) showing who the person is + what they're
 * doing, MS-Excel-style.
 *
 * Sizing is fixed in screen pixels rather than element-relative so the
 * badge stays readable regardless of canvas zoom / element rotation.
 * Positioned with CSS corner-offset so it hugs the element outline that
 * `EditorCanvas` already draws at `outline: 2px solid <user.color>`.
 */
export function RemoteSelectionBadge({ user }: { user: PresenceUser }) {
  const [hovering, setHovering] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Keep the tooltip glued to the badge through scroll/zoom/resize while it's open.
  useLayoutEffect(() => {
    if (!hovering) return
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({
        top: rect.bottom + 6,
        left: rect.left + rect.width / 2,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [hovering])

  return (
    <>
      <div
        ref={triggerRef}
        data-agreemint-remote-badge
        // Top-right corner of the element. `pointer-events: auto` so the
        // hover tooltip works even though the wrapper element has its own
        // hover styles. `-top-2.5 -right-2.5` places the badge straddling
        // the corner so it never occludes text content inside the box.
        className="pointer-events-auto absolute -right-2.5 -top-2.5 z-[45] flex h-5 w-5 cursor-help items-center justify-center rounded-full border-2 text-[9px] font-bold shadow-sm"
        style={{
          borderColor: user.color,
          backgroundColor: user.color,
          color: '#ffffff',
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        tabIndex={0}
        aria-label={`${user.name} is editing this element`}
        role="img"
      >
        {initials(user.name)}
      </div>
      {hovering && pos
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[9999] -translate-x-1/2 rounded-md px-2 py-1 text-[11px] font-medium text-white shadow-md"
              style={{
                top: pos.top,
                left: pos.left,
                backgroundColor: user.color,
              }}
            >
              <div className="whitespace-nowrap">
                {user.name} is editing
              </div>
              {user.email ? (
                <div className="whitespace-nowrap text-[10px] opacity-80">
                  {user.email}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
