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

function Avatar({
  user,
  isFollowed,
  onToggleFollow,
}: {
  user: PresenceUser
  isFollowed: boolean
  onToggleFollow: () => void
}) {
  return (
    <button
      type="button"
      className="group relative flex items-center"
      title={user.name}
      onClick={onToggleFollow}
    >
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white transition-transform hover:scale-110 lg:h-8 lg:w-8 lg:text-xs ${
          isFollowed ? 'animate-pulse' : ''
        }`}
        style={{ borderColor: user.color, backgroundColor: user.color + '33' }}
      >
        <span style={{ color: user.color }}>{initials(user.name)}</span>
      </div>

      {/* Tooltip */}
      <span className="pointer-events-none absolute -bottom-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-700">
        {user.name}
      </span>
    </button>
  )
}

export function PresenceAvatars() {
  const currentUser = useAuthStore((s) => s.user)
  const users = usePresenceStore((s) => s.users)
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
        {visible.map((u) => (
          <Avatar
            key={u.userId}
            user={u}
            isFollowed={followingUserId === u.userId}
            onToggleFollow={() =>
              setFollowing(followingUserId === u.userId ? null : u.userId)
            }
          />
        ))}
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
