import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { LifecycleStatusBadge } from '../components/documents/LifecycleStatusBadge'
import { Card, CardContent } from '../components/ui/Card'
import { SkeletonRow } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import type { LifecycleStatus } from '../lib/api'

const statusTabs: { value: LifecycleStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_REVIEW', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'ARCHIVED', label: 'Archived' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function Documents() {
  const { documents, stats, filterStatus, isLoading, fetchDocuments, fetchStats, setFilterStatus } =
    useDocumentStore()

  useEffect(() => {
    fetchDocuments()
    fetchStats()
  }, [fetchDocuments, fetchStats])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Documents</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage generated documents through their lifecycle
        </p>
      </div>

      {/* Stats */}
      {stats && (
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

      {/* Filter tabs */}
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
            filterStatus
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
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/documents/${doc.id}`}
                      className="font-medium text-zinc-900 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400"
                    >
                      {doc.title || 'Untitled document'}
                    </Link>
                    {doc.description && (
                      <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
                        {doc.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <LifecycleStatusBadge status={doc.lifecycleStatus} size="sm" />
                  </td>
                  <td className="hidden px-4 py-3 text-zinc-500 dark:text-zinc-400 md:table-cell">
                    {formatDate(doc.createdAt)}
                  </td>
                  <td className="hidden px-4 py-3 text-zinc-500 dark:text-zinc-400 lg:table-cell">
                    {doc.expiresAt ? formatDate(doc.expiresAt) : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default Documents
