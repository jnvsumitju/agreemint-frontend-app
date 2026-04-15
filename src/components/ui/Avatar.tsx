import type { ImgHTMLAttributes } from 'react'

/* ── Sizing ── */

const sizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
} as const

/* ── Props ── */

export interface AvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'size'> {
  src?: string | null
  name?: string
  email?: string
  size?: keyof typeof sizes
  ring?: boolean
}

/* ── Helpers ── */

function initials(name: string): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'
}

/* ── Component ── */

export function Avatar({ src, name, email, size = 'md', ring, className, ...props }: AvatarProps) {
  const ringClass = ring
    ? 'ring-2 ring-white dark:ring-zinc-900'
    : ''
  const label = name || email || '?'

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className={`shrink-0 rounded-full object-cover ${sizes[size]} ${ringClass} ${className ?? ''}`}
        {...props}
      />
    )
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-violet-100 font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300 ${sizes[size]} ${ringClass} ${className ?? ''}`}
      aria-label={label}
    >
      {initials(label)}
    </span>
  )
}

/* ── Avatar Stack ── */

interface AvatarStackProps {
  avatars: { src?: string | null; name?: string }[]
  max?: number
  size?: keyof typeof sizes
}

export function AvatarStack({ avatars, max = 4, size = 'sm' }: AvatarStackProps) {
  const shown = avatars.slice(0, max)
  const remaining = avatars.length - max

  return (
    <div className="flex -space-x-2">
      {shown.map((a, i) => (
        <Avatar key={i} src={a.src} name={a.name} size={size} ring />
      ))}
      {remaining > 0 && (
        <span
          className={`inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-medium text-zinc-600 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-300 dark:ring-zinc-900 ${sizes[size]}`}
        >
          +{remaining}
        </span>
      )}
    </div>
  )
}
