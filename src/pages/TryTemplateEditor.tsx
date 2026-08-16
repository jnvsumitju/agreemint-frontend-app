import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEditorStore } from '../stores/editorStore'
import { useTrySignUpStore } from '../stores/trySignUpStore'
import { useLocalYDoc } from '../collab/useLocalYDoc'
import { EditorShell } from '../components/editor/EditorShell'
import { TrySignUpModal } from '../components/try/TrySignUpModal'
import { Button } from '../components/ui/Button'
import { PageLoader } from '../components/ui/PageLoader'
import { parseLayoutJson, type LayoutJson } from '../types/layout'
import type { ParsedTemplatePayload } from '../lib/templateExport'
import {
  getTryTemplateMeta,
  loadTryTemplate,
  syntheticTemplateId,
  TEMPLATE_GALLERY_URL,
  UnknownTryTemplateError,
} from '../lib/tryTemplates'
import { discardTryDraft, readTryDraft, saveTryDraft } from '../lib/trySession'
import { useConfirm } from '../components/ui/ConfirmDialog'

/** Quiet period before a change is written to localStorage. */
const AUTOSAVE_DEBOUNCE_MS = 600

type BootStatus = 'loading' | 'ready' | 'not-found' | 'error'

/**
 * The anonymous editor at `/try/:slug`.
 *
 * <p>Same chrome as `/editor/:templateId`, populated from a static bundle
 * instead of the API, and making no authenticated calls at all — see
 * `src/lib/tryTemplates.ts` for why the layout is a glob import, and
 * `src/lib/trySession.ts` for how the work survives sign-up.
 */
export function TryTemplateEditor() {
  const { slug } = useParams<{ slug: string }>()
  const meta = slug ? getTryTemplateMeta(slug) : null
  const [status, setStatus] = useState<BootStatus>('loading')
  /**
   * Bumped by "Start over". Re-runs the boot effect and, while it is odd-numbered
   * for this visit, tells it to ignore the saved draft. Without an escape hatch a
   * visitor who edited a template once could never see the original again —
   * every subsequent visit restores their own edits, and this is a page people
   * land on precisely to have a look at what it comes with.
   */
  const [resetNonce, setResetNonce] = useState(0)

  // Mandatory even with no transport: without an active provider, every render
  // hands TipTap a brand-new Y fragment and the editor is rebuilt on each
  // keystroke. See useLocalYDoc for the full trace.
  useLocalYDoc(slug ? syntheticTemplateId(slug) : null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false

    // Order is load-bearing. `enterSandbox()` must run before `loadLayout`,
    // because `loadLayout` re-applies whatever viewOnly/canEdit were true when
    // it ran — permissions granted afterwards would be discarded by the load
    // itself and the visitor would land read-only.
    useEditorStore.getState().reset()
    useEditorStore.getState().enterSandbox()
    setStatus('loading')

    ;(async () => {
      try {
        // A draft from a previous visit wins over the pristine bundle — this
        // is what makes a reload (or an accidental back-navigation) safe.
        // "Start over" is the one case that deliberately skips it.
        const draft = resetNonce > 0 ? null : readTryDraft(slug)
        const parsed: ParsedTemplatePayload = draft
          ? (() => {
              const p = parseLayoutJson(draft.layout as unknown as LayoutJson)
              return {
                pages: p.pages,
                pageSpec: p.page,
                globalVariables: p.globalVariables,
                variableValues: draft.variableValues,
              }
            })()
          : await loadTryTemplate(slug)
        if (cancelled) return

        const s = useEditorStore.getState()
        // Set the id before the layout: EditorCanvas reads templateId from the
        // store (not from the route) to key its Yjs fragments.
        s.setTemplateMeta(syntheticTemplateId(slug), meta?.name ?? 'Template')
        s.loadLayout({
          pages: parsed.pages,
          page: parsed.pageSpec,
          globalVariables: parsed.globalVariables,
        })
        for (const [k, v] of Object.entries(parsed.variableValues)) s.setVariableValue(k, v)
        // No committed version exists, and none can — this keeps the version
        // badge and the "generate from latest version" action out of the way.
        s.setVersionInfo(null, null)

        const w = window.innerWidth
        if (w < 1024) s.setCanvasZoom(0.5)
        else if (w < 1440) s.setCanvasZoom(0.66)

        setStatus('ready')

        // Pin what is now on screen to disk. This matters on the "Start over"
        // path: switching status back to 'loading' tears down the persistence
        // effect below, whose cleanup flushes the *edited* state one last time.
        // That flush is synchronous with the re-render, so it lands before this
        // line, and this overwrites it with the pristine layout — otherwise a
        // visitor could press Start over, not touch anything, reload, and get
        // their old edits back.
        saveTryDraft(slug, meta?.name ?? 'Template', useEditorStore.getState())
      } catch (err) {
        if (cancelled) return
        setStatus(err instanceof UnknownTryTemplateError ? 'not-found' : 'error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [slug, meta?.name, resetNonce])

  // Persist continuously. Not via VITE_EDITOR_LOCAL_SAVE_INTERVAL_MS — that
  // knob is deliberately 0 because local snapshots outranking the server draft
  // corrupt element ids on a real template (see editorEnv.ts). This path has no
  // server draft to conflict with, so it is a different problem with a
  // different answer.
  useEffect(() => {
    if (!slug || status !== 'ready') return
    const name = meta?.name ?? 'Template'
    let timer: number | undefined

    const flush = () => {
      window.clearTimeout(timer)
      saveTryDraft(slug, name, useEditorStore.getState())
    }

    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      // Only the persisted slice. Subscribing to everything would reset the
      // debounce on each pointer move (canvasPointerPt updates on mousemove),
      // so a visitor moving the mouse while thinking would never get a write.
      if (
        state.pages === prev.pages &&
        state.pageSpec === prev.pageSpec &&
        state.variableValues === prev.variableValues &&
        state.globalVariableDefinitions === prev.globalVariableDefinitions
      ) {
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS)
    })

    // A reload or a tab close inside the debounce window would otherwise drop
    // the last few seconds of work.
    window.addEventListener('pagehide', flush)

    return () => {
      window.removeEventListener('pagehide', flush)
      unsubscribe()
      flush()
    }
  }, [slug, status, meta?.name])

  if (!slug) return <TryTemplateMissing />
  if (status === 'loading') return <PageLoader />
  if (status === 'not-found' || status === 'error') {
    return <TryTemplateMissing broken={status === 'error'} />
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TryBanner
        name={meta?.name ?? 'this template'}
        onStartOver={() => {
          discardTryDraft(slug)
          setStatus('loading')
          setResetNonce((n) => n + 1)
        }}
      />
      <div className="min-h-0 flex-1">
        <EditorShell />
      </div>
      <TrySignUpModal slug={slug} />
    </div>
  )
}

function TryBanner({ name, onStartOver }: { name: string; onStartOver: () => void }) {
  const promptSignUp = useTrySignUpStore((s) => s.promptSignUp)
  const confirm = useConfirm()

  const startOver = async () => {
    const ok = await confirm({
      title: 'Start over?',
      description: `This discards your changes and reloads ${name} exactly as it comes. It cannot be undone.`,
      confirmLabel: 'Discard my changes',
      variant: 'danger',
    })
    if (ok) onStartOver()
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-violet-200 bg-violet-50 px-4 py-2 dark:border-violet-900 dark:bg-violet-950/40">
      <p className="text-sm text-violet-900 dark:text-violet-200">
        You&rsquo;re editing <span className="font-semibold">{name}</span> without an account. Changes
        stay in this browser until you save them.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void startOver()}>
          Start over
        </Button>
        <Button size="sm" onClick={() => promptSignUp('save')}>
          Save to a free workspace
        </Button>
      </div>
    </div>
  )
}

function TryTemplateMissing({ broken }: { broken?: boolean } = {}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {broken ? 'That template could not be opened' : 'No such template'}
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {broken
          ? 'Something went wrong loading this one. Trying again usually works; if it does not, the gallery has the rest.'
          : 'The link may be out of date. Browse the gallery for the current set.'}
      </p>
      <a href={TEMPLATE_GALLERY_URL}>
        <Button variant="secondary">Browse templates</Button>
      </a>
    </div>
  )
}
