import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { usePermissions } from '../hooks/usePermissions'
import {
  createProduct,
  fetchProductMetrics,
  updateProduct,
  type ProductMetricsDto,
} from '../lib/api'
import { Button } from '../components/ui/Button'
import { Card, CardContent } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonRow } from '../components/ui/Skeleton'
import { Modal, ModalFooter } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Summary tile rendered in the header row — totals across all products. */
function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'violet' | 'zinc' }) {
  const toneCls = tone === 'violet'
    ? 'text-violet-700 dark:text-violet-300'
    : 'text-zinc-900 dark:text-zinc-100'
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}

export function Products() {
  const toast = useToast()
  const { isAdmin } = usePermissions()
  const orgId = useAuthStore((s) => s.org?.id ?? null)

  const [rows, setRows] = useState<ProductMetricsDto[]>([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [editing, setEditing] = useState<ProductMetricsDto | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!orgId) return
    setLoading(true)
    fetchProductMetrics(orgId)
      .then(setRows)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load products'))
      .finally(() => setLoading(false))
    // `toast` is stable; depending only on orgId avoids reload loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => ({
    products: rows.length,
    templates: rows.reduce((a, r) => a + r.templateCount, 0),
    uiDocs: rows.reduce((a, r) => a + r.uiDocumentCount, 0),
    apiDocs: rows.reduce((a, r) => a + r.apiDocumentCount, 0),
  }), [rows])

  async function handleCreate() {
    if (!orgId || !name.trim()) return
    setCreating(true)
    try {
      await createProduct(orgId, name.trim(), description.trim() || undefined)
      setCreateOpen(false); setName(''); setDescription('')
      toast.success('Product created')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveEdit() {
    if (!orgId || !editing) return
    setSaving(true)
    try {
      await updateProduct(orgId, editing.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      })
      setEditing(null)
      toast.success('Product updated')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Products</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Grouping above templates. Every new template is assigned to one.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            New product
          </Button>
        )}
      </div>

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Products" value={totals.products} />
        <StatCard label="Templates" value={totals.templates} />
        <StatCard label="UI docs" value={totals.uiDocs} tone="violet" />
        <StatCard label="API docs" value={totals.apiDocs} tone="violet" />
      </div>

      {/* List */}
      {loading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          description={isAdmin
            ? 'Create your first product to start grouping templates by line of business.'
            : 'An admin needs to create at least one product before templates can be created.'}
          action={isAdmin ? { label: 'Create product', onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">Product</th>
                <th className="hidden px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400 sm:table-cell">Templates</th>
                <th className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">Documents</th>
                <th className="hidden px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400 lg:table-cell">Last generated</th>
                {isAdmin && <th className="w-1 px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.name}</div>
                    {r.description && (
                      <p className="mt-0.5 max-w-md truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {r.description}
                      </p>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 align-top sm:table-cell">
                    {r.templateCount > 0 ? (
                      <Link
                        to={`/templates?productId=${r.id}`}
                        className="font-medium text-zinc-900 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400"
                      >
                        {r.templateCount}
                      </Link>
                    ) : (
                      <span className="text-zinc-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {r.documentCount.toLocaleString()}
                    </div>
                    {r.documentCount > 0 && (
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {r.uiDocumentCount} UI · {r.apiDocumentCount} API
                      </p>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 align-top text-zinc-500 dark:text-zinc-400 lg:table-cell">
                    {formatDate(r.lastDocumentAt)}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 align-top text-right">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          setEditing(r)
                          setEditName(r.name)
                          setEditDescription(r.description ?? '')
                        }}
                      >
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setName(''); setDescription('') }}
        title="New product"
        size="sm"
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Home Loans"
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional — what templates belong here?"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!name.trim()}
              onClick={() => void handleCreate()}
            >
              Create
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit product"
        size="sm"
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!editName.trim()}
              onClick={() => void handleSaveEdit()}
            >
              Save
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  )
}

export default Products
