import { useEffect, useMemo, useState } from 'react'
import { fetchOrgMembers, requestReviews, type OrgMemberDto } from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'

/**
 * Appears right after a successful `commitDraft`. The committed version is
 * optional — if omitted, the modal renders in "informational" mode (e.g. when
 * the user re-opens it later from a toolbar button).
 *
 * Reviewer picker: multi-select over org members filtered to roles that can
 * actually review (ADMIN / DESIGNER / REVIEWER). VIEWER-only members are still
 * listed so a designer can explicitly ask them, just greyed out as "view only"
 * so the designer knows that reviewer may not have edit-level suggestions.
 */
export function RequestReviewModal({
  open,
  onClose,
  templateId,
  versionId,
  versionNumber,
}: {
  open: boolean
  onClose: () => void
  templateId: string
  versionId: string | null
  versionNumber: number | null
}) {
  const toast = useToast()
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)

  const [members, setMembers] = useState<OrgMemberDto[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(new Set())
    setMessage('')
    if (orgId) {
      fetchOrgMembers(orgId).then(setMembers).catch(() => setMembers([]))
    }
  }, [open, orgId])

  const reviewableMembers = useMemo(() => {
    return members.filter((m) => m.userId !== currentUserId)
  }, [members, currentUserId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = reviewableMembers
    if (!q) return base
    return base.filter(
      (m) => m.email.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    )
  }, [query, reviewableMembers])

  const toggle = (userId: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function handleSubmit() {
    if (!versionId) {
      toast.error('No version to review yet — commit first')
      return
    }
    if (selected.size === 0) return
    setSubmitting(true)
    try {
      await requestReviews(templateId, versionId, Array.from(selected), message.trim() || undefined)
      toast.success(`Requested review from ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request review')
    } finally {
      setSubmitting(false)
    }
  }

  function initials(name: string | null | undefined): string {
    const safe = (name ?? '').trim()
    if (!safe) return '?'
    const parts = safe.split(/\s+/).filter(Boolean).slice(0, 2)
    if (parts.length === 0) return safe.charAt(0).toUpperCase()
    return parts.map((w) => w[0]!.toUpperCase()).join('')
  }

  return (
    <Modal open={open} onClose={onClose} title={versionNumber ? `Request review (v${versionNumber})` : 'Request review'} size="lg">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Pick one or more reviewers. Each one decides independently — any reviewer
        who requests mandatory changes will block the next commit until their
        feedback is addressed or the review is dismissed.
      </p>

      <div className="mt-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {reviewableMembers.length === 0 ? 'No other org members yet' : 'No matches'}
          </div>
        ) : (
          <ul role="listbox" aria-multiselectable="true">
            {filtered.map((m) => {
              const isSelected = selected.has(m.userId)
              return (
                <li
                  key={m.userId}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(m.userId)}
                  className={`flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-800 ${
                    isSelected
                      ? 'bg-violet-50 text-zinc-900 dark:bg-violet-900/30 dark:text-zinc-100'
                      : 'text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/70'
                  }`}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={isSelected}
                    className="h-4 w-4 accent-violet-600"
                  />
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                    {initials(m.name || m.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.name || m.email}</div>
                    {m.name && <div className="truncate text-[11px] text-zinc-500">{m.email}</div>}
                  </div>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {m.role}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Note to reviewers (optional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What should they look at?"
          rows={2}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Skip
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={submitting}
          disabled={selected.size === 0}
          onClick={() => void handleSubmit()}
        >
          Request {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
