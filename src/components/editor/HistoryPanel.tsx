import { useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import type { EditorUndoSnapshot } from '../../lib/editorHistory'
import { captureEditorUndoSnapshot, snapshotToPatch } from '../../lib/editorHistory'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'

function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function snapshotSummary(snap: EditorUndoSnapshot, idx: number, total: number): string {
  if (snap.undoLabel) return snap.undoLabel
  const elCount = snap.pages.reduce((n, p) => n + p.elements.length, 0)
  return `Step ${total - idx} · ${elCount} elements`
}

/** History timeline sidebar panel showing undo stack. */
export function HistoryPanel() {
  const undoPast = useEditorStore((s) => s.undoPast)
  const undoFuture = useEditorStore((s) => s.undoFuture)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)

  const [namedSnapshots, setNamedSnapshots] = useState<{ name: string; snapshot: EditorUndoSnapshot }[]>([])
  const [snapshotName, setSnapshotName] = useState('')

  const saveNamedSnapshot = () => {
    const name = snapshotName.trim() || `Checkpoint ${namedSnapshots.length + 1}`
    const snap = captureEditorUndoSnapshot(useEditorStore.getState(), name)
    setNamedSnapshots((prev) => [...prev, { name, snapshot: snap }])
    setSnapshotName('')
  }

  const restoreNamedSnapshot = (snap: EditorUndoSnapshot) => {
    const st = useEditorStore.getState()
    const patched = snapshotToPatch(snap)
    useEditorStore.setState({
      undoPast: [...st.undoPast, captureEditorUndoSnapshot(st, 'Before restore')],
      undoFuture: [],
      ...patched,
    })
  }

  const jumpToStep = (idx: number) => {
    const stepsToUndo = undoPast.length - idx
    for (let i = 0; i < stepsToUndo; i++) undo()
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Checkpoints */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Checkpoints
        </p>
        <div className="flex gap-1.5">
          <input
            type="text"
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            placeholder="Checkpoint name…"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNamedSnapshot() }}
          />
          <Button variant="primary" size="xs" onClick={saveNamedSnapshot}>Save</Button>
        </div>
        {namedSnapshots.length > 0 && (
          <div className="mt-2 space-y-1 rounded-lg border border-zinc-100 bg-zinc-50/50 p-2 dark:border-zinc-800 dark:bg-zinc-800/30">
            {namedSnapshots.map((ns, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors hover:bg-white dark:hover:bg-zinc-800">
                <span className="min-w-0 truncate text-[11px] text-zinc-700 dark:text-zinc-300" title={ns.name}>
                  {ns.name}
                </span>
                <Button variant="ghost" size="xs" onClick={() => restoreNamedSnapshot(ns.snapshot)}>
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Undo Timeline */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">History</span>
            <Badge variant="default" size="sm">{undoPast.length}</Badge>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" disabled={undoPast.length === 0} onClick={() => undo()}>Undo</Button>
            <Button variant="ghost" size="xs" disabled={undoFuture.length === 0} onClick={() => redo()}>Redo</Button>
          </div>
        </div>

        {undoPast.length === 0 && undoFuture.length === 0 ? (
          <EmptyState
            title="No history yet"
            description="Your undo/redo timeline will appear here"
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            className="py-6"
          />
        ) : (
          <div className="relative max-h-[280px] overflow-y-auto">
            {/* Vertical timeline line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-zinc-200 dark:bg-zinc-700" />

            <ul className="flex flex-col gap-0.5">
              {/* Future (grayed out) */}
              {undoFuture.map((snap, i) => (
                <li key={`f-${i}`} className="relative flex items-center gap-3 rounded-md px-1.5 py-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                  <span className="relative z-10 h-2 w-2 shrink-0 rounded-full border border-zinc-300 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800" />
                  <span className="min-w-0 truncate">{snap.undoLabel || `Redo step ${i + 1}`}</span>
                  <span className="ml-auto shrink-0 text-[8px] tabular-nums">{formatTime(snap.timestamp)}</span>
                </li>
              ))}

              {/* Current state */}
              <li className="relative flex items-center gap-3 rounded-lg bg-violet-50 px-1.5 py-1.5 dark:bg-violet-950/30">
                <span className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500 ring-2 ring-white dark:ring-zinc-900" />
                <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">Current state</span>
                <Badge variant="success" size="sm" className="ml-auto">Now</Badge>
              </li>

              {/* Past (clickable) */}
              {[...undoPast].reverse().map((snap, i) => {
                const idx = undoPast.length - 1 - i
                return (
                  <li key={`p-${i}`}>
                    <button
                      type="button"
                      className="relative flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left text-[10px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      title="Click to jump to this state"
                      onClick={() => jumpToStep(idx)}
                    >
                      <span className="relative z-10 h-2 w-2 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                      <span className="min-w-0 truncate">{snapshotSummary(snap, i, undoPast.length)}</span>
                      <span className="ml-auto shrink-0 text-[8px] tabular-nums">{formatTime(snap.timestamp)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
