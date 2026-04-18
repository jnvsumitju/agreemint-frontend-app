import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePermissions } from '../../hooks/usePermissions'
import {
  createProduct,
  fetchProducts,
  updateProduct,
  type ProductDto,
} from '../../lib/api'
import { Button } from '../ui/Button'
import { Modal, ModalFooter } from '../ui/Modal'
import { useToast } from '../ui/Toast'

/**
 * ADMIN-only catalog management for products — the grouping layer above
 * templates. Non-admins see a gentle hint; admins see a list, can rename
 * existing products, and can add new ones. Deletion is intentionally not
 * exposed: products can have templates FK'd to them and we don't want a
 * destructive cascade here in v1.
 */
export function ProductsTab() {
  const toast = useToast()
  const { isAdmin } = usePermissions()
  const orgId = useAuthStore((s) => s.org?.id ?? null)

  const [products, setProducts] = useState<ProductDto[]>([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [editing, setEditing] = useState<ProductDto | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    if (!orgId) return
    setLoading(true)
    fetchProducts(orgId)
      .then(setProducts)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load products'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function handleCreate() {
    if (!orgId || !name.trim()) return
    setCreating(true)
    try {
      const p = await createProduct(orgId, name.trim(), description.trim() || undefined)
      setProducts((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)))
      setCreateOpen(false)
      setName('')
      setDescription('')
      toast.success(`Product "${p.name}" created`)
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
      const p = await updateProduct(orgId, editing.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      })
      setProducts((prev) => prev
        .map((x) => (x.id === p.id ? p : x))
        .sort((a, b) => a.name.localeCompare(b.name)))
      setEditing(null)
      toast.success('Product updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
        Only admins can manage the product catalog.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Products</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Group your templates by product line. Every new template must be
            assigned to one.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          + New product
        </Button>
      </header>

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          Loading…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          No products yet. Create one to start grouping templates.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
          {products.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                {p.description && (
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {p.description}
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  setEditing(p)
                  setEditName(p.name)
                  setEditDescription(p.description ?? '')
                }}
              >
                Rename
              </Button>
            </li>
          ))}
        </ul>
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
        title="Rename product"
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
