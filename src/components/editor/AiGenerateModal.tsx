import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import {
  buildLayoutJson,
  parseLayoutJson,
  type LayoutDocumentPage,
  type LayoutElement,
} from '../../types/layout'
import { parseContentToRuns } from '../../lib/richContent'
import {
  clarifyAi,
  outlineAi,
  streamAiGenerate,
  type AiChunkContext,
  type AiClarifyQuestion,
  type AiOutlineSection,
} from '../../lib/api'

/**
 * Best-effort cleanup before {@link JSON.parse}. LLMs occasionally wrap
 * output in markdown fences despite being told not to, prepend a stray
 * "Here is the JSON:" line, or trail a single comma. We strip those so a
 * minor surface tic doesn't sink an otherwise valid response. Anything
 * deeper than that (unescaped quote, missing comma between values) still
 * fails — the surface error message tells the user to retry.
 */
function parseAiJson(raw: string): string {
  let text = (raw ?? '').trim()
  // Strip ```json fences (or plain ```) wrapping the whole document.
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenceMatch) text = fenceMatch[1].trim()
  // Slice off any prose before the first { or after the last }.
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace > 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1)
  }
  // Remove trailing commas before } or ] — common LLM slip-up that
  // standard JSON.parse rejects but is harmless to fix.
  text = text.replace(/,(\s*[}\]])/g, '$1')
  return text
}

/**
 * Fold the user's answers back into a single instruction string so the
 * streaming generator sees the full context as one user message. Free-text
 * answers are quoted; multiple-choice answers are written verbatim.
 */
function combineInstructionWithAnswers(
  instruction: string,
  questions: AiClarifyQuestion[],
  answers: Record<string, string>,
): string {
  const lines: string[] = [instruction.trim()]
  const answered = questions.filter((q) => (answers[q.id] ?? '').trim().length > 0)
  if (answered.length === 0) return lines[0]
  lines.push('', 'Additional details:')
  for (const q of answered) {
    lines.push(`- ${q.label} ${answers[q.id].trim()}`)
  }
  return lines.join('\n')
}

/** Plain text from a rich-content JSON string, capped to N chars. */
function elementPreview(el: LayoutElement, max = 40): string {
  if (typeof el.content === 'string' && el.content) {
    try {
      const runs = parseContentToRuns(el.content)
      const joined = runs
        .map((r) => (r.type === 'text' ? r.text : r.type === 'var' ? `{${r.name}}` : ''))
        .join('')
        .trim()
      if (joined) return joined.length > max ? joined.slice(0, max) + '…' : joined
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(el.listItems) && el.listItems.length > 0) {
    const t = (el.listItems[0]?.text ?? '').trim()
    if (t) return t.length > max ? t.slice(0, max) + '…' : t
  }
  return `${el.type} element`
}

/**
 * Compare the AI's result against the snapshot taken at submit time and
 * report which elements OTHER than the targeted one were touched. Used to
 * decide whether to show the scope-expanded confirmation popup.
 *
 * "Touched" means any of: id missing on either side, type changed,
 * geometry (x/y/w/h) changed, content string differs, or style JSON
 * differs. We don't try to be smart about insignificant differences —
 * if the JSON shape moves at all, that's a meaningful edit worth
 * surfacing.
 */
type ScopeChange = { id: string; label: string; kind: 'modified' | 'added' | 'removed' }

function diffScopeAgainstTarget(
  before: LayoutDocumentPage[],
  after: LayoutDocumentPage[],
  targetId: string,
): ScopeChange[] {
  const beforeById = new Map<string, LayoutElement>()
  for (const p of before) for (const e of p.elements) beforeById.set(e.id, e)
  const afterById = new Map<string, LayoutElement>()
  for (const p of after) for (const e of p.elements) afterById.set(e.id, e)

  const changes: ScopeChange[] = []
  for (const [id, el] of afterById) {
    if (id === targetId) continue
    const orig = beforeById.get(id)
    if (!orig) {
      changes.push({ id, label: elementPreview(el), kind: 'added' })
      continue
    }
    if (
      orig.type !== el.type ||
      orig.x !== el.x ||
      orig.y !== el.y ||
      orig.width !== el.width ||
      orig.height !== el.height ||
      (orig.content ?? '') !== (el.content ?? '') ||
      JSON.stringify(orig.style ?? {}) !== JSON.stringify(el.style ?? {})
    ) {
      changes.push({ id, label: elementPreview(el), kind: 'modified' })
    }
  }
  for (const [id, el] of beforeById) {
    if (id === targetId) continue
    if (!afterById.has(id)) {
      changes.push({ id, label: elementPreview(el), kind: 'removed' })
    }
  }
  return changes
}

/**
 * Heuristic — does the user's instruction look like it's asking for a
 * long, structured document that would benefit from chunked generation?
 * Picks up explicit page counts ("25 pages", "10-15 page") and the
 * common scale words ("comprehensive", "extensive", "very detailed").
 *
 * False negatives are fine — we just fall back to single-pass. False
 * positives are slightly worse: chunked mode adds latency for the
 * outline call. So the regex stays conservative.
 */
function looksLikeLongDoc(instruction: string): boolean {
  const t = instruction.toLowerCase()
  if (/\b(\d+)\s*[-–]?\s*(?:to\s+)?\d*\s*pages?\b/.test(t)) {
    const m = t.match(/\b(\d+)\s*pages?\b/)
    if (m && Number(m[1]) >= 5) return true
  }
  return /\b(comprehensive|extensive|very\s+detailed|thoroughly|exhaustive|legal(?:ly)?\s+detailed|annexures?|sub[\s-]?clauses?)\b/.test(t)
}

/**
 * Group sections into chunks of ~3 (target 6–10 pages per chunk so each
 * generation call stays well within V4-Flash's quality sweet spot).
 * Sections with high estimatedPages get their own chunk; small ones group.
 */
function chunkSections(sections: AiOutlineSection[]): AiOutlineSection[][] {
  if (sections.length === 0) return []
  const TARGET_PAGES_PER_CHUNK = 7
  const chunks: AiOutlineSection[][] = []
  let current: AiOutlineSection[] = []
  let currentPages = 0
  for (const s of sections) {
    const sp = Math.max(1, Math.min(20, s.estimatedPages ?? 2))
    // Big section gets its own chunk if adding it would way overshoot.
    if (current.length > 0 && currentPages + sp > TARGET_PAGES_PER_CHUNK + 2) {
      chunks.push(current)
      current = []
      currentPages = 0
    }
    current.push(s)
    currentPages += sp
    if (currentPages >= TARGET_PAGES_PER_CHUNK) {
      chunks.push(current)
      current = []
      currentPages = 0
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Render a list of sections as bullet-prefixed newline-separated lines for the prompt. */
function formatSectionsForPrompt(sections: AiOutlineSection[]): string {
  return sections
    .map((s) => `  • ${s.title}${s.summary ? ` — ${s.summary}` : ''}`)
    .join('\n')
}

type Phase = 'instruction' | 'checking' | 'questions' | 'confirm'

/**
 * Magic-wand modal — collects a plain-English instruction, optionally
 * surfaces 1–4 follow-up questions from the model, then opens an SSE
 * stream to the backend's DeepSeek proxy. On completion the generated
 * layout enters the store as a *pending* preview (Accept / Reject buttons
 * appear in the status bar).
 *
 * Four phases:
 *   - "instruction": user types the prompt
 *   - "checking":    waiting for the clarifier to decide ready vs ask
 *   - "questions":   render N choice/text questions; user answers them
 *   - "confirm":     scope-expanded confirmation (right-click flow only) —
 *                    AI touched elements OTHER than the user's target;
 *                    show the list and ask "Apply" / "Discard".
 *
 * Title swap (instruction phase only):
 *   - Right-click target set                        → "Modify selected element with AI"
 *   - Empty template (no elements anywhere)        → "Generate template from scratch"
 *   - Has any user-placed element                   → "Modify template with AI"
 *
 * The modal closes itself the moment the generation stream actually starts;
 * the full-screen blur loader takes over and stays up until the stream
 * completes (or fails).
 */
export function AiGenerateModal() {
  const open = useEditorStore((s) => s.aiModalOpen)
  const setOpen = useEditorStore((s) => s.setAiModalOpen)
  const targetElementId = useEditorStore((s) => s.aiModalTargetElementId)
  const setGenerating = useEditorStore((s) => s.setAiGenerating)
  const appendStreaming = useEditorStore((s) => s.appendAiStreamingText)
  const resetStreaming = useEditorStore((s) => s.resetAiStreamingText)
  const setChunkProgress = useEditorStore((s) => s.setAiChunkProgress)
  const applyPending = useEditorStore((s) => s.applyAiPendingLayout)
  const pages = useEditorStore((s) => s.pages)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const templateId = useEditorStore((s) => s.templateId)

  const elementCount = useMemo(
    () => pages.reduce((sum, p) => sum + p.elements.length, 0),
    [pages]
  )
  const isEmpty = elementCount === 0
  const isTargeted = !!targetElementId
  const targetEl = useMemo(() => {
    if (!targetElementId) return null
    for (const p of pages) for (const e of p.elements) if (e.id === targetElementId) return e
    return null
  }, [pages, targetElementId])

  const title = isTargeted
    ? 'Modify selected element with AI'
    : isEmpty
      ? 'Generate template from scratch'
      : 'Modify template with AI'
  const subtitle = isTargeted
    ? `Describe the change for ${targetEl ? `"${elementPreview(targetEl, 30)}"` : 'this element'}. The AI will keep other elements unchanged unless they have to move.`
    : isEmpty
      ? 'Describe the document you want to create — invoice, contract, certificate, anything.'
      : 'Describe the change you want, e.g. "add a signature line at the bottom" or "make the header bold and centered".'

  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState<Phase>('instruction')
  const [questions, setQuestions] = useState<AiClarifyQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pendingResult, setPendingResult] = useState<{
    parsed: ReturnType<typeof parseLayoutJson>
    scopeChanges: ScopeChange[]
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const streamedRef = useRef<string>('')
  // Snapshot the pages array taken at submit time so we can diff the AI's
  // result against the original even after `pages` has been mutated by
  // intermediate work (e.g. another collaborator's edit).
  const submitSnapshotRef = useRef<LayoutDocumentPage[] | null>(null)

  useEffect(() => {
    if (!open) {
      setInstruction('')
      setPhase('instruction')
      setQuestions([])
      setAnswers({})
      setError(null)
      setPendingResult(null)
      streamedRef.current = ''
      submitSnapshotRef.current = null
      return
    }
    // Focus textarea on open
    queueMicrotask(() => textareaRef.current?.focus())
  }, [open])

  if (!open) return null

  /**
   * Run a single SSE generation pass and resolve with the parsed layout.
   * Handles delta accumulation + final JSON parse. Used both for the
   * single-pass flow and as the per-chunk worker in chunked mode.
   */
  const runSinglePass = (payload: Parameters<typeof streamAiGenerate>[1]): Promise<ReturnType<typeof parseLayoutJson>> =>
    new Promise((resolve, reject) => {
      let acc = ''
      streamAiGenerate(templateId!, payload, {
        onDelta: (chunk) => {
          acc += chunk
          appendStreaming(chunk)
        },
        onDone: () => {
          try {
            const json = JSON.parse(parseAiJson(acc))
            resolve(parseLayoutJson(json))
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            const snippet = acc ? ` (first 200 chars: ${acc.slice(0, 200)}…)` : ''
            reject(new Error(`Invalid JSON from AI${snippet}. ${detail}`))
          }
        },
        onError: (msg) => reject(new Error(msg || 'Generation failed')),
      })
    })

  const handleStreamFailure = (err: unknown) => {
    setGenerating(false)
    setChunkProgress(null)
    setOpen(true)
    setError(err instanceof Error ? err.message : String(err))
  }

  const finishWithLayout = (parsed: ReturnType<typeof parseLayoutJson>) => {
    setChunkProgress(null)
    if (targetElementId && submitSnapshotRef.current) {
      const scopeChanges = diffScopeAgainstTarget(
        submitSnapshotRef.current,
        parsed.pages,
        targetElementId,
      )
      if (scopeChanges.length > 0) {
        setGenerating(false)
        setPendingResult({ parsed, scopeChanges })
        setPhase('confirm')
        setOpen(true)
        return
      }
    }
    applyPending(parsed)
  }

  const startStreaming = async (finalInstruction: string) => {
    streamedRef.current = ''
    submitSnapshotRef.current = pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => ({ ...e })),
    }))

    // Hand control over to the loader overlay; close the modal so the
    // user sees the page-wide blur, not a stale modal frame on top of it.
    setGenerating(true)
    setOpen(false)

    const variables = {
      global: globalVariableDefinitions,
      pageLocal: pages.map((p) => ({ pageId: p.id, name: p.name, variables: p.localVariables ?? [] })),
    }

    // Long-document path: outline first, then chunk into sequential
    // generation passes. Falls back to single-pass on any outline
    // failure so it doesn't break the broader flow.
    if (!targetElementId && looksLikeLongDoc(finalInstruction)) {
      try {
        setChunkProgress({ current: 0, total: 1, label: 'Planning sections…' })
        const initialLayout = buildLayoutJson(pages, pageSpec, globalVariableDefinitions)
        const outline = await outlineAi(templateId!, {
          instruction: finalInstruction,
          currentLayout: initialLayout,
          variables,
        })
        const sections = Array.isArray(outline.sections) ? outline.sections : []
        if (sections.length > 1) {
          const chunks = chunkSections(sections)
          // Seed the accumulator with the live editor state so the first
          // chunk sees the user's existing pages as context (typically
          // empty for from-scratch generation, but might contain a
          // partial template the user is iterating on).
          let accumulated: ReturnType<typeof parseLayoutJson> = {
            pages,
            page: pageSpec,
            globalVariables: globalVariableDefinitions,
          }
          const completed: AiOutlineSection[] = []
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            const firstSection = chunk[0]
            setChunkProgress({
              current: i + 1,
              total: chunks.length,
              label: firstSection?.title ?? `Generating chunk ${i + 1}`,
            })
            resetStreaming()
            const layoutForCall = buildLayoutJson(accumulated.pages, accumulated.page, accumulated.globalVariables)
            const chunkContext: AiChunkContext = {
              chunkIndex: i,
              totalChunks: chunks.length,
              sectionsToGenerate: formatSectionsForPrompt(chunk),
              completedSectionTitles: completed.length > 0 ? formatSectionsForPrompt(completed) : undefined,
            }
            const next = await runSinglePass({
              instruction: finalInstruction,
              currentLayout: layoutForCall,
              variables,
              chunkContext,
            })
            accumulated = next
            completed.push(...chunk)
          }
          finishWithLayout(accumulated)
          return
        }
        // Outline returned nothing useful — fall through to single pass.
      } catch (e) {
        console.warn('[AI] outline/chunked path failed, falling back to single pass', e)
        setChunkProgress(null)
      }
    }

    // Single-pass path — the original flow.
    const currentLayout = buildLayoutJson(pages, pageSpec, globalVariableDefinitions)
    try {
      const parsed = await runSinglePass({
        instruction: finalInstruction,
        currentLayout,
        variables,
        targetElementId: targetElementId ?? undefined,
      })
      finishWithLayout(parsed)
    } catch (e) {
      handleStreamFailure(e)
    }
  }

  const handleSubmitInstruction = async () => {
    const text = instruction.trim()
    if (!text || !templateId) return
    setError(null)
    setPhase('checking')
    try {
      const currentLayout = buildLayoutJson(pages, pageSpec, globalVariableDefinitions)
      const variables = {
        global: globalVariableDefinitions,
        pageLocal: pages.map((p) => ({ pageId: p.id, name: p.name, variables: p.localVariables ?? [] })),
      }
      const reply = await clarifyAi(templateId, {
        instruction: text,
        currentLayout,
        variables,
        targetElementId: targetElementId ?? undefined,
      })
      if (reply.questions && reply.questions.length > 0) {
        setQuestions(reply.questions)
        // Pre-select first option for any choice questions so the form is
        // valid even if the user just clicks Generate without changing
        // anything.
        const seed: Record<string, string> = {}
        for (const q of reply.questions) {
          if (q.type === 'choice' && q.options && q.options.length > 0) seed[q.id] = q.options[0]
        }
        setAnswers(seed)
        setPhase('questions')
      } else {
        // Model said it has enough info — proceed straight to generation.
        startStreaming(text)
      }
    } catch (e) {
      // Clarifier failed — degrade gracefully and just generate.
      const detail = e instanceof Error ? e.message : String(e)
      console.warn('[AI] clarify failed, proceeding to generate', detail)
      startStreaming(text)
    }
  }

  const handleSubmitAnswers = () => {
    const combined = combineInstructionWithAnswers(instruction.trim(), questions, answers)
    startStreaming(combined)
  }

  const handleSkipQuestions = () => {
    startStreaming(instruction.trim())
  }

  const handleConfirmApply = () => {
    if (pendingResult) applyPending(pendingResult.parsed)
    setPendingResult(null)
    setOpen(false)
  }

  const handleConfirmDiscard = () => {
    setPendingResult(null)
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-modal-title"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
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
            <h2 id="ai-modal-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {phase === 'questions'
                ? 'A few quick questions'
                : phase === 'confirm'
                  ? 'AI also wants to change other elements'
                  : title}
            </h2>
            <p className="mt-0.5 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
              {phase === 'questions'
                ? 'Your answers help the AI generate a result closer to what you want. Skip any you don\'t care about.'
                : phase === 'checking'
                  ? 'Checking if the AI needs any details before generating…'
                  : phase === 'confirm'
                    ? 'You asked to modify one element, but the AI\'s edit also touches the elements below. Apply anyway, or discard the whole change?'
                    : subtitle}
            </p>
          </div>
        </div>

        {phase === 'instruction' && (
          <textarea
            ref={textareaRef}
            rows={5}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={
              isTargeted
                ? 'e.g. "make this red", "change the font to Times New Roman, 14pt", "rephrase as a more formal greeting"'
                : isEmpty
                  ? 'e.g. "A two-page invoice in A4 with a logo header, customer details, line items table, totals, and a signature line at the bottom"'
                  : 'e.g. "Add a footer with the page number on the right side"'
            }
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleSubmitInstruction()
              }
            }}
            className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        )}

        {phase === 'checking' && (
          <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-6 dark:border-zinc-700 dark:bg-zinc-800/50">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" aria-hidden />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Asking the AI if it needs more details…</p>
          </div>
        )}

        {phase === 'questions' && (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {questions.map((q) => (
              <div key={q.id}>
                <label className="mb-1.5 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {q.label}
                </label>
                {q.type === 'choice' && q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((opt) => {
                      const selected = answers[q.id] === opt
                      return (
                        <button
                          type="button"
                          key={opt}
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                          className={
                            'rounded-full border px-3 py-1 text-[12.5px] transition-colors ' +
                            (selected
                              ? 'border-violet-500 bg-violet-500 text-white shadow-sm'
                              : 'border-zinc-300 bg-white text-zinc-700 hover:border-violet-400 hover:bg-violet-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700')
                          }
                        >
                          {opt}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={answers[q.id] ?? ''}
                    placeholder={q.placeholder ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        handleSubmitAnswers()
                      }
                    }}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {phase === 'confirm' && pendingResult && (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
            <ul className="space-y-1.5 text-zinc-800 dark:text-zinc-100">
              {pendingResult.scopeChanges.slice(0, 12).map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <span
                    className={
                      'mt-0.5 inline-flex shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                      (c.kind === 'added'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : c.kind === 'removed'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
                          : 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100')
                    }
                  >
                    {c.kind}
                  </span>
                  <span className="min-w-0 truncate">{c.label}</span>
                </li>
              ))}
              {pendingResult.scopeChanges.length > 12 && (
                <li className="text-[12px] italic text-zinc-500 dark:text-zinc-400">
                  …and {pendingResult.scopeChanges.length - 12} more.
                </li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 p-2 font-sans text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </pre>
        )}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {phase === 'questions'
              ? 'Answer or skip — both work'
              : phase === 'confirm'
                ? `${pendingResult?.scopeChanges.length ?? 0} additional element(s) affected`
                : '⌘/Ctrl+Enter to generate'}
          </p>
          <div className="flex gap-2">
            {phase === 'questions' && (
              <button
                type="button"
                onClick={handleSkipQuestions}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Skip
              </button>
            )}
            {phase === 'confirm' ? (
              <>
                <button
                  type="button"
                  onClick={handleConfirmDiscard}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleConfirmApply}
                  className="rounded-md bg-gradient-to-br from-fuchsia-500 to-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-95"
                >
                  Apply changes
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={
                    phase === 'questions'
                      ? handleSubmitAnswers
                      : phase === 'instruction'
                        ? handleSubmitInstruction
                        : undefined
                  }
                  disabled={
                    phase === 'checking' ||
                    (phase === 'instruction' && !instruction.trim())
                  }
                  className="rounded-md bg-gradient-to-br from-fuchsia-500 to-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {phase === 'questions' ? 'Generate with these answers' : 'Generate'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
