import type { HTMLAttributes } from 'react'

/* ── Shimmer Skeleton ── */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-zinc-200/70 dark:bg-zinc-800 ${className ?? ''}`}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 dark:via-white/5 to-transparent" />
    </div>
  )
}

/* ── Preset Skeletons ── */

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3.5"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900 ${className ?? ''}`}>
      <Skeleton className="mb-3 h-5 w-2/3" />
      <SkeletonText lines={2} />
      <Skeleton className="mt-4 h-3 w-1/3" />
    </div>
  )
}

export function SkeletonAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'
  return <Skeleton className={`rounded-full ${dims}`} />
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <SkeletonAvatar />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}
