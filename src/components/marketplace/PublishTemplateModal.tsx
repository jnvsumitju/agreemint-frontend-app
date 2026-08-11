import { useEffect, useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { authFetch } from '../../lib/api'

/** Mirrors CATEGORIES on the Marketplace page. */
const CATEGORIES = ['Contracts', 'Legal', 'HR', 'Finance', 'Marketing', 'Other'] as const

export interface PublishTemplateModalProps {
  open: boolean
  onClose: () => void
  templateId: string
  templateName: string
  /** Shown as the listing's author. */
  authorName: string
  onPublished?: () => void
}

/**
 * Publish a template to the marketplace.
 *
 * <p>The copy here is deliberately blunt about two things, because both are
 * irreversible in ways people do not expect. Publishing takes a <em>snapshot</em>
 * — later edits to the template do not reach anyone who installed it — and it is
 * visible to every other workspace immediately, with no review step. A template
 * built from a real customer agreement carries that customer's terms, and the
 * moment it is published someone else can install it.
 */
export function PublishTemplateModal({
  open,
  onClose,
  templateId,
  templateName,
  authorName,
  onPublished,
}: PublishTemplateModalProps) {
  const [title, setTitle] = useState(templateName)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle(templateName)
      setDescription('')
      setCategory(CATEGORIES[0])
      setAcknowledged(false)
      setError(null)
    }
  }, [open, templateName])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await authFetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          authorName,
          sourceTemplateId: templateId,
          category,
          tags: null,
        }),
      })
      if (!res.ok) {
        // The backend rejects a template with no committed version — there
        // would be nothing to snapshot — and that is worth saying plainly.
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || 'Could not publish this template')
      }
      onPublished?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish to marketplace"
      description="Share this template with every other Crixaa workspace."
      size="md"
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="listing-title" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Listing title
          </label>
          <input
            id="listing-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="listing-description" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Description
          </label>
          <textarea
            id="listing-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            placeholder="What is this template for, and who is it useful to?"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="listing-category" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Category
          </label>
          <select
            id="listing-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={saving}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-semibold">This is public to all Crixaa workspaces straight away.</p>
          <p className="mt-1">
            There is no review step. A copy of the template as it is right now is taken and shared —
            later edits stay private to you, and anyone who installs it keeps their copy even if you
            withdraw the listing afterwards.
          </p>
          <p className="mt-1">
            Check it does not contain real client names, prices or terms.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={saving}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500/40 dark:border-zinc-600"
          />
          <span>I have checked this template contains no confidential information.</span>
        </label>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>

      <ModalFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          loading={saving}
          disabled={!title.trim() || !acknowledged}
          onClick={() => void submit()}
        >
          Publish
        </Button>
      </ModalFooter>
    </Modal>
  )
}
