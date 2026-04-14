import { useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import type { EditorUndoSnapshot } from '../../lib/editorHistory'
import { captureEditorUndoSnapshot, snapshotToPatch } from '../../lib/editorHistory'

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

  // Named snapshots (session-only for now)
  const [namedSnapshots, setNamedSnapshots] = useState<{ name: string; snapshot: EditorUndoSnapshot }[]>([])
  const [snapshotName, setSnapshotName] = useState('')

  const saveNamedSnapshot = () => {
    const name = snapshotName.trim() || `Checkpoint ${namedSnapshots.length + 1}`
    const snap = captureEditorUndoSnapshot(useEditorStore.getState(), name)
    setNamedSnapshots((prev) => [...prev, { name, snapshot: snap }])
    setSnapshotName('')
  }

  const restoreNamedSnapshot = (snap: EditorUndoSnapshot) => {
    // Push current state to undo before restoring
    const st = useEditorStore.getState()
    const patched = snapshotToPatch(snap)
    useEditorStore.setState({
      undoPast: [...st.undoPast, captureEditorUndoSnapshot(st, 'Before restore')],
      undoFuture: [],
      ...patched,
    })
  }

  const jumpToStep = (idx: number) => {
    // Jump to a specific undo step: undo multiple times
    const stepsToUndo = undoPast.length - idx
    for (let i = 0; i < stepsToUndo; i++) {
      undo()
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Named snapshots */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs dark:text-zinc-400">
          Checkpoints
        </p>
        <div className="flex gap-1">
          <input
            type="text"
            className="min-w-0 flex-1 rounded border border-zinc-300 px-1.5 py-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            placeholder="Checkpoint name…"
            value={snapshotName}
            onChange={(e) => setSnapshotName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNamedSnapshot() }}
          />
          <button
            type="button"
            className="shrink-0 rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-800 hover:bg-violet-100 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100"
            onClick={saveNamedSnapshot}
          >
            Save
          </button>
        </div>
        {namedSnapshots.length > 0 && (
          <ul className="flex flex-col gap-1 rounded border border-zinc-200 bg-white/50 p-1.5 dark:border-zinc-600 dark:bg-zinc-900/40">
            {namedSnapshots.map((ns, i) => (
              <li key={i} className="flex items-center justify-between gap-1 text-[10px] lg:text-[11px]">
                <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300" title={ns.name}>
                  {ns.name}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-900/30"
                  onClick={() => restoreNamedSnapshot(ns.snapshot)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Undo timeline */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs dark:text-zinc-400">
            History ({undoPast.length} steps)
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700"
              disabled={undoPast.length === 0}
              onClick={() => undo()}
            >
              Undo
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700"
              disabled={undoFuture.length === 0}
              onClick={() => redo()}
            >
              Redo
            </button>
          </div>
        </div>

        {undoPast.length === 0 && undoFuture.length === 0 ? (
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500">No history yet.</p>
        ) : (
          <ul className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto">
            {/* Future (grayed out) */}
            {undoFuture.map((snap, i) => (
              <li
                key={`f-${i}`}
                className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-zinc-400 dark:text-zinc-500"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span className="min-w-0 truncate">
                  {snap.undoLabel || `Redo step ${i + 1}`}
                </span>
                <span className="ml-auto shrink-0 text-[8px] tabular-nums">
                  {formatTime(snap.timestamp)}
                </span>
              </li>
            ))}
            {/* Current state marker */}
            <li className="flex items-center gap-1.5 rounded bg-violet-50 px-1.5 py-1 text-[10px] font-medium text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
              <span>Current state</span>
            </li>
            {/* Past (clickable) */}
            {[...undoPast].reverse().map((snap, i) => {
              const idx = undoPast.length - 1 - i
              return (
                <li key={`p-${i}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    title="Click to jump to this state"
                    onClick={() => jumpToStep(idx)}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                    <span className="min-w-0 truncate">
                      {snapshotSummary(snap, i, undoPast.length)}
                    </span>
                    <span className="ml-auto shrink-0 text-[8px] tabular-nums">
                      {formatTime(snap.timestamp)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
