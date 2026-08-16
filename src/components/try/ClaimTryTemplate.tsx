import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { createProduct, createTemplate, commitDraft, fetchProducts, putDraft } from '../../lib/api'
import {
  clearTryClaim,
  discardTryDraft,
  readClaimableTryDraft,
  type TryDraft,
} from '../../lib/trySession'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * Moves a template edited anonymously at `/try/:slug` into the workspace of
 * whoever just signed in.
 *
 * <p>Mounted inside `ProtectedRoute`'s authenticated branch rather than being
 * its own route, because there are four ways to arrive at a session — password
 * registration, an emailed verification link, an OAuth round trip, and plain
 * login on an existing account — and they land on different paths. Watching for
 * "authenticated, and there is a claim on disk" catches all four without
 * touching any of them.
 *
 * <p>The write is the same `createTemplate → putDraft → commitDraft` sequence
 * `duplicateTemplate` uses. `POST /api/templates/import` would also work but
 * demands a `productId` query param and an ADMIN/DESIGNER role, which buys
 * nothing here.
 */
export function ClaimTryTemplate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const navigate = useNavigate()

  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [draft, setDraft] = useState<TryDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A second run would create a duplicate template — the effect's deps include
  // orgId, which changes as /auth/me resolves.
  const startedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !orgId || startedRef.current) return
    const pending = readClaimableTryDraft()
    if (!pending) return

    startedRef.current = true
    setDraft(pending)
    setState('saving')

    ;(async () => {
      try {
        // Query before creating, so someone who already has products does not
        // accumulate a new "My Documents" bucket on every claim.
        const products = await fetchProducts(orgId)
        const product = products[0] ?? (await createProduct(orgId, 'My Documents'))

        const template = await createTemplate(pending.name, product.id)
        await putDraft(template.id, pending.layout, pending.variableValues)
        await commitDraft(template.id)

        clearTryClaim()
        discardTryDraft(pending.slug)
        navigate(`/editor/${template.id}`, { replace: true })
      } catch (err) {
        // Deliberately leave the draft and the claim marker in place. The
        // common failures here are recoverable by the user — joining an
        // existing workspace as a VIEWER (403 on create), or hitting the Free
        // plan's template cap (402) — and the work is the one thing they
        // cannot reconstruct.
        setError(err instanceof Error ? err.message : 'Could not save the template.')
        setState('failed')
      }
    })()
  }, [isAuthenticated, orgId, navigate])

  if (state === 'idle') return null

  if (state === 'saving') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-zinc-950/80">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Saving {draft?.name ?? 'your template'} to your workspace…
          </span>
        </div>
      </div>
    )
  }

  return (
    <Modal
      open
      onClose={() => setState('idle')}
      title="We could not save that template"
      size="md"
      persistent
    >
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{error}</p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Your work is still saved in this browser. Reopening the template will bring it back, and you
        can export it from <span className="font-medium">File → Export JSON</span> to keep a copy
        anywhere.
      </p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => setState('idle')}>
          Dismiss
        </Button>
        {draft && (
          <Button variant="secondary" onClick={() => navigate(`/try/${draft.slug}`)}>
            Back to the template
          </Button>
        )}
      </div>
    </Modal>
  )
}
