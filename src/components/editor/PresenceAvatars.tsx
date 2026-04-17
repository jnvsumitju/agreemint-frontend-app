import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePresenceStore } from '../../stores/presenceStore'
import type { PresenceUser } from '../../stores/presenceStore'

const MAX_VISIBLE = 5

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/**
 * Avatar with a click-to-open popover offering "Follow" / "Stop following".
 * When B clicks A's avatar, a tiny card appears with A's name, the page A is
 * currently on, and a button to start/stop following. Following syncs B's
 * active page + viewport to A's via the /viewport STOMP channel.
 */
function Avatar({
  user,
  isFollowed,
  followedPage,
  onToggleFollow,
}: {
  user: PresenceUser
  isFollowed: boolean
  /** 1-based page number the user is currently viewing (undefined while unknown). */
  followedPage: number | undefined
  onToggleFollow: () => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="group relative flex items-center"
        title={user.name}
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white transition-transform hover:scale-110 lg:h-8 lg:w-8 lg:text-xs ${
            isFollowed ? 'animate-pulse' : ''
          }`}
          style={{ borderColor: user.color, backgroundColor: user.color + '33' }}
        >
          <span style={{ color: user.color }}>{initials(user.name)}</span>
        </div>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          role="menu"
        >
          <div className="flex items-center gap-2 border-b border-zinc-100 px-1.5 pb-2 dark:border-zinc-800">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold lg:h-8 lg:w-8 lg:text-xs"
              style={{ borderColor: user.color, backgroundColor: user.color + '33' }}
            >
              <span style={{ color: user.color }}>{initials(user.name)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {user.name}
              </div>
              <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {followedPage ? `On Page ${followedPage}` : 'On this template'}
              </div>
            </div>
          </div>

          <button
            type="button"
            className={`mt-1.5 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              isFollowed
                ? 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
            }`}
            onClick={() => {
              onToggleFollow()
              setOpen(false)
            }}
          >
            <span>{isFollowed ? 'Stop following' : 'Follow'}</span>
            {isFollowed && (
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 10.5l3 3 7-7" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export function PresenceAvatars() {
  const currentUser = useAuthStore((s) => s.user)
  const users = usePresenceStore((s) => s.users)
  const viewports = usePresenceStore((s) => s.viewports)
  const followingUserId = usePresenceStore((s) => s.followingUserId)
  const setFollowing = usePresenceStore((s) => s.setFollowing)

  // Exclude the current user from the avatar list
  const otherUsers = currentUser
    ? users.filter((u) => u.userId !== currentUser.id)
    : users

  if (otherUsers.length === 0) return null

  const visible = otherUsers.slice(0, MAX_VISIBLE)
  const overflow = otherUsers.length - MAX_VISIBLE

  const followedUser = followingUserId
    ? otherUsers.find((u) => u.userId === followingUserId)
    : null

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center -space-x-1">
        {visible.map((u) => {
          const vp = viewports[u.userId]
          const pageOneBased =
            typeof vp?.activePageIndex === 'number' ? vp.activePageIndex + 1 : undefined
          return (
            <Avatar
              key={u.userId}
              user={u}
              isFollowed={followingUserId === u.userId}
              followedPage={pageOneBased}
              onToggleFollow={() =>
                setFollowing(followingUserId === u.userId ? null : u.userId)
              }
            />
          )
        })}
        {overflow > 0 && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-300 bg-zinc-100 text-[10px] font-semibold text-zinc-600 lg:h-8 lg:w-8 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            +{overflow}
          </div>
        )}
      </div>

      {/* Following banner */}
      {followedUser && (
        <div
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white lg:text-xs"
          style={{ backgroundColor: followedUser.color }}
        >
          <span>Following {followedUser.name}</span>
          <button
            type="button"
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] leading-none text-white hover:bg-white/40"
            title="Stop following"
            aria-label="Stop following"
            onClick={(e) => {
              e.stopPropagation()
              setFollowing(null)
            }}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  )
}
