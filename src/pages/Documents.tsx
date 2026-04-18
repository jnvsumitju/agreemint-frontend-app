import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { LifecycleStatusBadge } from '../components/documents/LifecycleStatusBadge'
import { Card, CardContent } from '../components/ui/Card'
import { SkeletonRow } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import type { DocumentSource, LifecycleStatus } from '../lib/api'

/** Status sub-tabs are only meaningful on the UI tab — API docs have no lifecycle. */
const statusTabs: { value: LifecycleStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_REVIEW', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'ARCHIVED', label: 'Archived' },
]

/** Top-level source tabs: UI-generated (managed) vs API-generated (pass-through). */
const sourceTabs: { value: DocumentSource | null; label: string; hint: string }[] = [
  { value: 'UI_GENERATED', label: 'Managed', hint: 'Documents generated in the app — full review lifecycle' },
  { value: 'API_GENERATED', label: 'API', hint: 'Documents generated via the developer API — no lifecycle managed here' },
  { value: null, label: 'All', hint: 'Everything generated under this workspace' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Violet pill badge rendered in place of the lifecycle badge for API docs. */
function ApiSourceBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2a1 1 0 011 1v1.09a6.003 6.003 0 014.91 4.91H17a1 1 0 110 2h-1.09a6.003 6.003 0 01-4.91 4.91V17a1 1 0 11-2 0v-1.09A6.003 6.003 0 014.09 11H3a1 1 0 110-2h1.09A6.003 6.003 0 019 4.09V3a1 1 0 011-1z" />
      </svg>
      API
    </span>
  )
}

export function Documents() {
  const {
    documents, stats, filterStatus, filterSource, isLoading,
    fetchDocuments, fetchStats, setFilterStatus, setFilterSource,
  } = useDocumentStore()

  useEffect(() => {
    fetchDocuments()
    fetchStats()
  }, [fetchDocuments, fetchStats])

  const onApiTab = filterSource === 'API_GENERATED'

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Documents</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage generated documents through their lifecycle
        </p>
      </div>

      {/* Source tabs — UI vs API vs All */}
      <div className="mb-6 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50">
        {sourceTabs.map((tab) => (
          <button
            key={tab.label}
            title={tab.hint}
            onClick={() => setFilterSource(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filterSource === tab.value
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Stats + status tabs — only apply when the managed (UI) tab is selected,
          since API docs don't have a lifecycle. */}
      {!onApiTab && stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'EXPIRED'] as LifecycleStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(filterStatus === status ? null : status)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                filterStatus === status
                  ? 'border-violet-300 bg-violet-50 dark:border-violet-600 dark:bg-violet-900/20'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600'
              }`}
            >
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {stats.counts[status] ?? 0}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {status.replace(/_/g, ' ')}
              </p>
            </button>
          ))}
        </div>
      )}

      {!onApiTab && (
        <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-700">
          {statusTabs.map((tab) => (
            <button
              key={tab.label}
              onClick={() => setFilterStatus(tab.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filterStatus === tab.value
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {onApiTab && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-violet-800 dark:border-violet-900 dark:bg-violet-900/10 dark:text-violet-200">
          Documents created via the developer API. These don't go through the in-app review
          lifecycle — the consuming system handles that on their side. You can still preview and
          download each one.
        </div>
      )}

      {/* Document list */}
      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </CardContent>
        </Card>
      ) : documents.length === 0 ? (
        <EmptyState
          title="No documents found"
          description={
            onApiTab
              ? 'No documents have been generated via the developer API yet.'
              : filterStatus
                ? `No documents with status "${filterStatus.replace(/_/g, ' ')}"`
                : 'Generate a document from a template to get started'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">Title</th>
                <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">Status</th>
                <th className="hidden px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400 md:table-cell">Created</th>
                <th className="hidden px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400 lg:table-cell">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {documents.map((doc) => {
                const isApi = doc.source === 'API_GENERATED'
                return (
                  <tr
                    key={doc.id}
                    className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/documents/${doc.id}`}
                        className="font-medium text-zinc-900 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400"
                      >
                        {doc.title || (isApi ? `API doc ${doc.id.slice(0, 8)}` : 'Untitled document')}
                      </Link>
                      {doc.description && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
                          {doc.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isApi || !doc.lifecycleStatus ? (
                        <ApiSourceBadge />
                      ) : (
                        <LifecycleStatusBadge status={doc.lifecycleStatus} size="sm" />
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-500 dark:text-zinc-400 md:table-cell">
                      {formatDate(doc.createdAt)}
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-500 dark:text-zinc-400 lg:table-cell">
                      {doc.expiresAt ? formatDate(doc.expiresAt) : '\u2014'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default Documents
