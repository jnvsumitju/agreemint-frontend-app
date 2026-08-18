import { usePlan } from '../../hooks/usePlan'
import { useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { fixPageLayout } from '../../lib/api'
import { detectPageIssues, describeIssue, type PageIssue } from '../../lib/pageIssueDetector'
import { buildLayoutJson, parseLayoutJson } from '../../types/layout'

type ModalState =
  | { kind: 'closed' }
  | { kind: 'issues'; issues: PageIssue[]; pageIndex: number }
  | { kind: 'fixing' }
  | { kind: 'no_issues' }
  | { kind: 'error'; message: string }

/**
 * Small pill anchored to the top-right of the page canvas. Click runs the
 * client-side issue detector against the active page; if it finds anything
 * (overlap, off-page, glued text, height drift) we show a popover listing
 * the issues with a "Fix with AI" button. Clean pages produce a friendly
 * "no issues" toast — no AI tokens spent on the happy path.
 *
 * Mounted by {@link EditorCanvas} once per editor (not per page); the
 * detector picks up whichever page is currently active.
 */
export function FixLayoutBadge() {
  const templateId = useEditorStore((s) => s.templateId)
  const pages = useEditorStore((s) => s.pages)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const applyPending = useEditorStore((s) => s.applyAiPendingLayout)
  const aiPending = useEditorStore((s) => s.aiPendingSnapshot)
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const sandbox = useEditorStore((s) => s.sandbox)

  const [state, setState] = useState<ModalState>({ kind: 'closed' })
  const { atLeast } = usePlan()

  // Hide for read-only roles (REVIEWER / VIEWER). Fix Layout produces
  // a pending-preview that mutates the layout — users without edit
  // rights can't accept it, so showing the affordance is misleading.
  if (viewOnly) return null
  // AI layout repair is Starter and up. Hidden rather than badged: this is a
  // contextual fix-it affordance, and a dead one next to a real problem reads
  // as broken rather than as an upsell.
  if (!atLeast('STARTER')) return null
  // Anonymous sandbox. Covered incidentally by the plan check above — with no
  // org there is no plan — but stated explicitly so this cannot silently start
  // firing authenticated AI requests from a public page if plan resolution
  // ever changes its default.
  if (sandbox) return null
  // Suppress while a pending AI preview is already on screen — the user
  // can't see what "fix layout" would do until they accept/reject the
  // existing suggestion.
  if (aiPending) return null

  const runDetect = () => {
    const page = pages[activePageIndex]
    if (!page) return
    const report = detectPageIssues(page, activePageIndex, pageSpec)
    if (report.issues.length === 0) {
      setState({ kind: 'no_issues' })
      window.setTimeout(() => setState({ kind: 'closed' }), 2200)
      return
    }
    setState({ kind: 'issues', issues: report.issues, pageIndex: activePageIndex })
  }

  const runFix = async (issues: PageIssue[], pageIndex: number) => {
    if (!templateId) return
    setState({ kind: 'fixing' })
    try {
      const page = pages[pageIndex]
      if (!page) throw new Error('Page no longer exists')
      // Build the JSON shape the backend expects — same `pages[i]` format
      // the broader generate flow uses, scoped to one page.
      const layoutJson = buildLayoutJson(pages, pageSpec, globalVariableDefinitions)
      const pageJson = layoutJson.pages?.[pageIndex] ?? null
      if (!pageJson) throw new Error('Failed to serialize page JSON')
      const corrected = await fixPageLayout(templateId, {
        page: pageJson,
        pageSpec,
        variables: {
          global: globalVariableDefinitions,
          pageLocal: page.localVariables ?? [],
        },
        issues: issues.map((i) => issueToWire(i)),
      })
      // Splice the corrected page back into the layout, then re-parse the
      // whole thing so we hit the same defensive coercion + de-overlap
      // that the broader AI-apply path goes through.
      const nextPages = (layoutJson.pages ?? []).map((p, i) => (i === pageIndex ? corrected : p))
      const nextLayout = { ...layoutJson, pages: nextPages }
      const parsed = parseLayoutJson(nextLayout as Record<string, unknown>)
      applyPending(parsed)
      setState({ kind: 'closed' })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setState({ kind: 'error', message: detail })
    }
  }

  const closeModal = () => setState({ kind: 'closed' })

  return (
    <>
      <div className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />
      <button
        type="button"
        onClick={runDetect}
        title="Detect and fix overlap, overflow, glued text and height drift on this page"
        // In the status bar now, not floating. Pinned at right-[320px]/top-[80px]
        // it sat over the properties panel's tab strip and covered whichever tab
        // happened to be underneath it — "Comments", in a default layout.
        className="flex items-center gap-1 rounded-full border border-fuchsia-300 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700 transition-colors hover:bg-fuchsia-50 dark:border-fuchsia-700 dark:text-fuchsia-300 dark:hover:bg-fuchsia-500/10"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14.5 9.5L4 20" />
          <path d="M14.5 9.5l5-5" />
          <path d="M13 8l3 3" />
        </svg>
        Fix layout
      </button>

      {state.kind === 'no_issues' && (
        <div className="fixed right-6 top-[112px] z-50 rounded-md border border-emerald-300 bg-white px-3 py-2 text-[12px] text-emerald-700 shadow-md dark:border-emerald-700 dark:bg-zinc-900 dark:text-emerald-300">
          ✓ Page looks clean — no issues detected.
        </div>
      )}

      {(state.kind === 'issues' || state.kind === 'fixing' || state.kind === 'error') && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={state.kind === 'fixing' ? undefined : closeModal}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14.5 9.5L4 20" />
                  <path d="M14.5 9.5l5-5" />
                  <path d="M13 8l3 3" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {state.kind === 'fixing' ? 'Fixing page layout…' : state.kind === 'error' ? 'Fix failed' : 'Issues detected'}
                </h2>
                <p className="mt-0.5 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {state.kind === 'fixing'
                    ? 'AI is applying minimal corrections — this usually takes 10–30 seconds.'
                    : state.kind === 'error'
                      ? 'The AI fix call did not complete. You can try again or close.'
                      : `Found ${state.issues.length} issue${state.issues.length === 1 ? '' : 's'} on this page. Review and let AI fix them.`}
                </p>
              </div>
            </div>

            {state.kind === 'issues' && (
              <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-zinc-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-zinc-100">
                {state.issues.slice(0, 25).map((issue, i) => (
                  <li key={`${issue.kind}-${issue.elementId}-${i}`} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
                      {issue.kind.replace('_', ' ')}
                    </span>
                    <span className="min-w-0">{describeIssue(issue)}</span>
                  </li>
                ))}
                {state.issues.length > 25 && (
                  <li className="text-[11px] italic text-zinc-500 dark:text-zinc-400">
                    …and {state.issues.length - 25} more.
                  </li>
                )}
              </ul>
            )}

            {state.kind === 'fixing' && (
              <div className="flex items-center justify-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-6 dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" aria-hidden />
                <p className="text-sm text-zinc-600 dark:text-zinc-300">DeepSeek is correcting the page…</p>
              </div>
            )}

            {state.kind === 'error' && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 p-2 font-sans text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {state.message}
              </pre>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              {state.kind !== 'fixing' && (
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  {state.kind === 'error' ? 'Close' : 'Cancel'}
                </button>
              )}
              {state.kind === 'issues' && (
                <button
                  type="button"
                  onClick={() => runFix(state.issues, state.pageIndex)}
                  className="rounded-md bg-gradient-to-br from-fuchsia-500 to-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-95"
                >
                  Fix with AI
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function issueToWire(i: PageIssue): { kind: string; elementId: string; data?: Record<string, unknown> } {
  switch (i.kind) {
    case 'overlap':
      return { kind: i.kind, elementId: i.elementId, data: { otherId: i.otherId, overlapPt: i.overlapPt } }
    case 'overflow_bottom':
      return { kind: i.kind, elementId: i.elementId, data: { overflowPt: i.overflowPt } }
    case 'overflow_horizontal':
      return { kind: i.kind, elementId: i.elementId, data: { side: i.side, overflowPt: i.overflowPt } }
    case 'height_drift':
      return { kind: i.kind, elementId: i.elementId, data: { storedHeight: i.storedHeight, measuredHeight: i.measuredHeight } }
    case 'glued_text':
      return { kind: i.kind, elementId: i.elementId, data: { sample: i.sample } }
  }
}

