import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { LifecycleStatusBadge } from '../components/documents/LifecycleStatusBadge'
import { DocumentTimeline } from '../components/documents/DocumentTimeline'
import { ApprovalWorkflowPanel } from '../components/documents/ApprovalWorkflowPanel'
import { CreateWorkflowModal } from '../components/documents/CreateWorkflowModal'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { usePlan } from '../hooks/usePlan'
import { PdfViewer } from '../components/pdf/PdfViewer'
import { Button } from '../components/ui/Button'
import { Card, CardHeader, CardContent } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import { fetchDocumentFileBlob, type LifecycleStatus } from '../lib/api'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Map lifecycle status to the actions a user can take. API-sourced docs
 *  have `status === null` and fall through to the empty default. */
function getActions(status: LifecycleStatus | null): { label: string; target: LifecycleStatus; variant: 'primary' | 'secondary' | 'danger' | 'ghost' }[] {
  switch (status) {
    case 'DRAFT':
      return [
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    case 'REJECTED':
      return [
        { label: 'Return to Draft', target: 'DRAFT', variant: 'secondary' },
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    case 'APPROVED':
      return [
        { label: 'Mark as Sent', target: 'SENT', variant: 'primary' },
        { label: 'Mark as Active', target: 'ACTIVE', variant: 'secondary' },
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    case 'SENT':
      return [
        { label: 'Mark as Signed', target: 'SIGNED', variant: 'primary' },
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    case 'SIGNED':
      return [
        { label: 'Mark as Active', target: 'ACTIVE', variant: 'primary' },
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    case 'ACTIVE':
      return [
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    case 'EXPIRED':
      return [
        { label: 'Archive', target: 'ARCHIVED', variant: 'ghost' },
      ]
    default:
      return []
  }
}

export function DocumentDetail() {
  const { documentId } = useParams<{ documentId: string }>()
  const { currentDocument, isLoading, fetchDocumentDetail, transitionStatus, clearCurrentDocument } =
    useDocumentStore()
  const [showWorkflowModal, setShowWorkflowModal] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  // Lifecycle and approvals are PRO-only (Starter does not include them).
  // The server enforces the same bar and returns 402.
  const { atLeast } = usePlan()
  const hasLifecycle = atLeast('PRO')
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (documentId) fetchDocumentDetail(documentId)
    return () => clearCurrentDocument()
  }, [documentId, fetchDocumentDetail, clearCurrentDocument])

  // Load the PDF as an authenticated blob so the preview iframe can render it
  // same-origin (the backend `/file` endpoint requires Authorization and sets
  // `X-Frame-Options: DENY`, so a raw cross-origin iframe src fails).
  const fileUrl = currentDocument?.document.fileUrl
  const generationStatus = currentDocument?.document.generationStatus
  useEffect(() => {
    if (!fileUrl || generationStatus !== 'COMPLETED') {
      setPdfBlobUrl(null)
      return
    }
    let cancelled = false
    let created: string | null = null
    fetchDocumentFileBlob(fileUrl)
      .then((blob) => {
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setPdfBlobUrl(created)
      })
      .catch(() => {
        if (!cancelled) setPdfBlobUrl(null)
      })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileUrl, generationStatus])

  if (isLoading || !currentDocument) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Skeleton className="mb-4 h-8 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
          <div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  const { document: doc, timeline, workflow } = currentDocument
  const isApi = doc.source === 'API_GENERATED'
  // API docs skip the lifecycle workflow — no transitions, no approval
  // workflow, no timeline worth showing.
  const actions = isApi ? [] : getActions(doc.lifecycleStatus)

  async function handleTransition(target: LifecycleStatus) {
    if (!documentId) return
    setTransitioning(true)
    try {
      await transitionStatus(documentId, target)
    } finally {
      setTransitioning(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          to="/documents"
          className="text-sm text-zinc-500 transition-colors hover:text-violet-600 dark:text-zinc-400 dark:hover:text-violet-400"
        >
          &larr; Back to Documents
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {doc.title || (isApi ? `API doc ${doc.id.slice(0, 8)}` : 'Untitled document')}
            </h1>
            {isApi || !doc.lifecycleStatus ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 2a1 1 0 011 1v1.09a6.003 6.003 0 014.91 4.91H17a1 1 0 110 2h-1.09a6.003 6.003 0 01-4.91 4.91V17a1 1 0 11-2 0v-1.09A6.003 6.003 0 014.09 11H3a1 1 0 110-2h1.09A6.003 6.003 0 019 4.09V3a1 1 0 011-1z" />
                </svg>
                API
              </span>
            ) : (
              <LifecycleStatusBadge status={doc.lifecycleStatus} />
            )}
          </div>
          {doc.description && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{doc.description}</p>
          )}
        </div>
        {pdfBlobUrl && (
          <a
            href={pdfBlobUrl}
            download={`${doc.title || 'document'}.pdf`}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download PDF
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Document info */}
        <div className="space-y-6 lg:col-span-2">
          {/* PDF preview — rendered from a same-origin blob URL that
              `fetchDocumentFileBlob` loaded with the Bearer token. Raw
              `src={backendUrl}` would 401 + trip X-Frame-Options: DENY. */}
          {doc.fileUrl && doc.generationStatus === 'COMPLETED' && (
            <Card>
              <CardContent className="p-0">
                <div className="h-[600px] w-full overflow-hidden rounded-xl lg:h-[760px]">
                  {pdfBlobUrl ? (
                    <PdfViewer
                      blobUrl={pdfBlobUrl}
                      downloadFileName={`${doc.title || 'document'}.pdf`}
                    />
                  ) : (
                    // Page-shaped, so the placeholder and the real first page
                    // occupy the same box and nothing jumps when it arrives.
                    <div className="flex h-full w-full items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
                      <Skeleton className="h-full w-auto" style={{ aspectRatio: '8.5 / 11' }} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Details</h3>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400">Generation Status</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{doc.generationStatus}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400">Created</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{formatDate(doc.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400">Last Updated</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{formatDate(doc.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500 dark:text-zinc-400">Expires</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                    {doc.expiresAt ? formatDate(doc.expiresAt) : 'No expiration'}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Right: Actions + Workflow + Timeline — hidden for API-generated
            documents since they don't participate in our lifecycle. */}
        <div className="space-y-6">
          {isApi ? (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Source
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Generated via the developer API. Review and approval are handled by the
                  consuming system — the in-app lifecycle workflow does not apply here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Actions */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Actions</h3>
                </CardHeader>
                <CardContent className="space-y-2">
                  {!hasLifecycle && (
                    <UpgradePrompt
                      feature="Document lifecycle"
                      requiredPlan="Pro"
                      description="Move documents through review, approval and expiry, with a full audit timeline of who did what."
                    />
                  )}

                  {/* Submit for Review (special — opens modal) */}
                  {hasLifecycle && doc.lifecycleStatus === 'DRAFT' && !workflow && (
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={() => setShowWorkflowModal(true)}
                    >
                      Submit for Review
                    </Button>
                  )}

                  {hasLifecycle && actions.map((action) => (
                    <Button
                      key={action.target}
                      variant={action.variant}
                      className="w-full"
                      loading={transitioning}
                      onClick={() => handleTransition(action.target)}
                    >
                      {action.label}
                    </Button>
                  ))}

                  {hasLifecycle && actions.length === 0 && doc.lifecycleStatus === 'ARCHIVED' && (
                    <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                      This document is archived
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Approval Workflow */}
              {workflow && (
                <Card>
                  <CardContent>
                    <ApprovalWorkflowPanel workflow={workflow} documentId={doc.id} />
                  </CardContent>
                </Card>
              )}

              {/* Timeline */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Timeline</h3>
                </CardHeader>
                <CardContent>
                  <DocumentTimeline events={timeline} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Create Workflow Modal */}
      <CreateWorkflowModal
        open={showWorkflowModal}
        onClose={() => setShowWorkflowModal(false)}
        documentId={doc.id}
      />
    </div>
  )
}

export default DocumentDetail
