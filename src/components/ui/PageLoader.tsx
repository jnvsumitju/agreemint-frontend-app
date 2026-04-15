export function PageLoader() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-8 w-8">
          <div className="absolute inset-0 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-violet-600" />
        </div>
        <span className="text-sm text-zinc-400 dark:text-zinc-500">Loading...</span>
      </div>
    </div>
  )
}
