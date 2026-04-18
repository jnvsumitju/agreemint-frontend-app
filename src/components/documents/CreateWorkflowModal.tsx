import { useState, useEffect } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { createApprovalWorkflow, fetchOrgMembers, type OrgMemberDto } from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { useDocumentStore } from '../../stores/documentStore'

interface StepInput {
  assigneeId: string
  roleLabel: string
}

export function CreateWorkflowModal({
  open,
  onClose,
  documentId,
}: {
  open: boolean
  onClose: () => void
  documentId: string
}) {
  const fetchDocumentDetail = useDocumentStore((s) => s.fetchDocumentDetail)
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const [members, setMembers] = useState<OrgMemberDto[]>([])
  const [steps, setSteps] = useState<StepInput[]>([{ assigneeId: '', roleLabel: '' }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !orgId) return
    // Previously hit the wrong path (`/api/org/members`) with no shape guard;
    // the 404 body ({"error": "Not found"}) got stored in `members`, and the
    // subsequent `.map()` blew up the page. Route through the shared
    // `fetchOrgMembers` helper (correct URL, normalised shape, array-or-throw).
    fetchOrgMembers(orgId)
      .then((list) => setMembers(Array.isArray(list) ? list : []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [open, orgId])

  function addStep() {
    setSteps([...steps, { assigneeId: '', roleLabel: '' }])
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return
    setSteps(steps.filter((_, i) => i !== index))
  }

  function updateStep(index: number, field: keyof StepInput, value: string) {
    const updated = [...steps]
    updated[index] = { ...updated[index], [field]: value }
    setSteps(updated)
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const updated = [...steps]
    ;[updated[index], updated[target]] = [updated[target], updated[index]]
    setSteps(updated)
  }

  async function handleSubmit() {
    const validSteps = steps.filter((s) => s.assigneeId)
    if (validSteps.length === 0) {
      setError('Add at least one approval step')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await createApprovalWorkflow(documentId, validSteps)
      await fetchDocumentDetail(documentId)
      onClose()
      setSteps([{ assigneeId: '', roleLabel: '' }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Approval Workflow" description="Add reviewers in the order they should approve." size="lg">
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
            <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              {i + 1}
            </span>
            <div className="flex-1 space-y-2">
              <select
                value={step.assigneeId}
                onChange={(e) => updateStep(i, 'assigneeId', e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">Select reviewer</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name || m.email} ({m.role})
                  </option>
                ))}
              </select>
              <Input
                placeholder="Role label (e.g., Legal Review)"
                value={step.roleLabel}
                onChange={(e) => updateStep(i, 'roleLabel', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => moveStep(i, -1)}
                disabled={i === 0}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700"
                title="Move up"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                </svg>
              </button>
              <button
                onClick={() => moveStep(i, 1)}
                disabled={i === steps.length - 1}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 disabled:opacity-30 dark:hover:bg-zinc-700"
                title="Move down"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={() => removeStep(i)}
                disabled={steps.length <= 1}
                className="rounded p-1 text-red-400 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-900/20"
                title="Remove"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={addStep}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 py-2 text-sm text-zinc-500 transition-colors hover:border-violet-400 hover:text-violet-600 dark:border-zinc-600 dark:hover:border-violet-500"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add step
        </button>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={loading} onClick={handleSubmit}>
          Submit for Review
        </Button>
      </ModalFooter>
    </Modal>
  )
}
