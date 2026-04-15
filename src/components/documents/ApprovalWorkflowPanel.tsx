import { useState } from 'react'
import type { ApprovalWorkflowDto } from '../../lib/api'
import { approveStep, rejectStep } from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { useDocumentStore } from '../../stores/documentStore'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

const stepStatusConfig = {
  PENDING: { variant: 'warning' as const, label: 'Pending' },
  APPROVED: { variant: 'success' as const, label: 'Approved' },
  REJECTED: { variant: 'danger' as const, label: 'Rejected' },
  SKIPPED: { variant: 'default' as const, label: 'Skipped' },
}

export function ApprovalWorkflowPanel({ workflow, documentId }: { workflow: ApprovalWorkflowDto; documentId: string }) {
  const user = useAuthStore((s) => s.user)
  const fetchDocumentDetail = useDocumentStore((s) => s.fetchDocumentDetail)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleApprove(stepId: string) {
    setLoading(true)
    try {
      await approveStep(stepId, comment || undefined)
      setComment('')
      await fetchDocumentDetail(documentId)
    } catch {
      // error handled by store
    } finally {
      setLoading(false)
    }
  }

  async function handleReject(stepId: string) {
    setLoading(true)
    try {
      await rejectStep(stepId, comment || undefined)
      setComment('')
      await fetchDocumentDetail(documentId)
    } catch {
      // error handled by store
    } finally {
      setLoading(false)
    }
  }

  // Find the first pending step (the current active one)
  const activeStep = workflow.steps.find((s) => s.status === 'PENDING')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Approval Workflow</h3>
        <Badge
          variant={workflow.status === 'APPROVED' ? 'success' : workflow.status === 'REJECTED' ? 'danger' : 'warning'}
          size="sm"
        >
          {workflow.status}
        </Badge>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        {workflow.steps.map((step, i) => {
          const config = stepStatusConfig[step.status]
          const isActive = activeStep?.id === step.id
          const isCurrentUserStep = isActive && user?.id === step.assigneeId

          return (
            <div key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Connector */}
              {i < workflow.steps.length - 1 && (
                <div className="absolute left-3 top-7 h-[calc(100%-12px)] w-px bg-zinc-200 dark:bg-zinc-700" />
              )}

              {/* Step indicator */}
              <div
                className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.status === 'APPROVED'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : step.status === 'REJECTED'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : isActive
                    ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {step.status === 'APPROVED' ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : step.status === 'REJECTED' ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  step.stepOrder
                )}
              </div>

              {/* Step content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {step.assigneeName ?? 'Unknown'}
                  </p>
                  <Badge variant={config.variant} size="sm">{config.label}</Badge>
                </div>
                {step.roleLabel && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{step.roleLabel}</p>
                )}
                {step.comment && (
                  <p className="mt-1 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {step.comment}
                  </p>
                )}
                {step.decidedAt && (
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {new Date(step.decidedAt).toLocaleString()}
                  </p>
                )}

                {/* Action buttons for current user */}
                {isCurrentUserStep && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      placeholder="Add a comment (optional)"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={loading}
                        onClick={() => handleApprove(step.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={loading}
                        onClick={() => handleReject(step.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
