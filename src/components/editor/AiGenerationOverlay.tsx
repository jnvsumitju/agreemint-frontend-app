import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'

/**
 * Full-page blur backdrop shown while DeepSeek is streaming a response.
 * Surfaces a determinate-looking progress bar that combines two signals:
 *   - elapsed time, asymptotically approaching ~85% over a 35-second
 *     budget (so the bar feels alive even before any tokens arrive)
 *   - actual streamed character count, mapped against an ~8000-char
 *     typical layout — once tokens start flowing the bar can leap past
 *     the time-based estimate.
 * The two are merged with Math.max so the user always sees the most
 * optimistic position, but the bar never reaches 100% until done.
 *
 * No Cancel button by design — aborting mid-stream can leave the layout
 * in a half-applied state. The user can wait for completion and Reject
 * if they don't like the result.
 */
export function AiGenerationOverlay() {
  const generating = useEditorStore((s) => s.aiGenerating)
  const streamingText = useEditorStore((s) => s.aiStreamingText)
  const chunkProgress = useEditorStore((s) => s.aiChunkProgress)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!generating) {
      startedAtRef.current = null
      setElapsedMs(0)
      return
    }
    startedAtRef.current = performance.now()
    const tick = () => {
      if (startedAtRef.current == null) return
      setElapsedMs(performance.now() - startedAtRef.current)
    }
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [generating])

  if (!generating) return null

  const chars = streamingText.length
  // Time-based: 0 → 85 % asymptotically over BUDGET_MS.
  const BUDGET_MS = 35_000
  const TARGET_MAX = 0.85
  const tProgress = TARGET_MAX * (1 - Math.exp(-elapsedMs / BUDGET_MS))
  // Char-based: assume an 8000-char typical full layout.
  const cProgress = Math.min(0.95, chars / 8000)
  const pct = Math.round(Math.max(tProgress, cProgress) * 100)
  const seconds = Math.floor(elapsedMs / 1000)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="flex w-[320px] flex-col items-center gap-4 rounded-2xl bg-white px-8 py-6 shadow-2xl dark:bg-zinc-900">
        <div className="relative flex h-12 w-12 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-fuchsia-400/40" />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14.5 9.5L4 20" />
              <path d="M14.5 9.5l5-5" />
              <path d="M13 8l3 3" />
            </svg>
          </div>
        </div>
        <div className="w-full text-center">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {chunkProgress
              ? `Section ${chunkProgress.current} of ${chunkProgress.total}`
              : 'Generating with AI…'}
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            {chunkProgress ? chunkProgress.label : 'AI is composing your template.'}
          </p>
        </div>
        <div className="w-full">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
            <span>{pct}%</span>
            <span>
              {seconds}s · {chars.toLocaleString()} chars
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Floating Accept / Reject bar shown after an AI generation completes —
 * appears at the bottom of the canvas while {@code aiPendingSnapshot} is
 * non-null. Accept folds the previous state into the undo stack as a
 * single step; Reject restores the previous state without leaving an undo
 * trace.
 */
export function AiPendingBar() {
  const pending = useEditorStore((s) => s.aiPendingSnapshot)
  const accept = useEditorStore((s) => s.acceptAiPending)
  const reject = useEditorStore((s) => s.rejectAiPending)
  if (!pending) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-7 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-fuchsia-300 bg-white/95 px-4 py-2 shadow-lg backdrop-blur dark:border-fuchsia-700 dark:bg-zinc-900/95">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M14.5 9.5L4 20" />
              <path d="M14.5 9.5l5-5" />
            </svg>
          </span>
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            AI suggestion ready
          </span>
        </div>
        <div className="h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
        <button
          type="button"
          onClick={reject}
          className="rounded-md px-3 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={accept}
          className="rounded-md bg-gradient-to-br from-fuchsia-500 to-violet-600 px-3 py-1 text-sm font-medium text-white shadow-sm hover:opacity-95"
        >
          Accept
        </button>
      </div>
    </div>
  )
}
