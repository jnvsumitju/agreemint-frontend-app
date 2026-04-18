import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePermissions } from '../hooks/usePermissions'
import { useAuthStore } from '../stores/authStore'
import {
  createProduct,
  createTemplate,
  duplicateTemplate,
  fetchProducts,
  fetchTemplates,
  type ProductDto,
  type TemplateDto,
} from '../lib/api'
import {
  addTemplateTag,
  allUsedTags,
  getAllTemplateTags,
  removeTemplateTag,
  SUGGESTED_TAGS,
} from '../lib/templateTags'
import { getAllThumbnails } from '../lib/templateThumbnails'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonCard } from '../components/ui/Skeleton'
import { Modal, ModalFooter } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'

type ViewMode = 'grid' | 'list'
type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc'

/* ── Sort Helpers ── */

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
]

function sortTemplates(list: TemplateDto[], sort: SortOption): TemplateDto[] {
  const sorted = [...list]
  switch (sort) {
    case 'newest':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    case 'oldest':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name))
  }
}

/* ── Tag Pill ── */

function TagPill({
  tag, onRemove, onClick, active,
}: {
  tag: string; onRemove?: () => void; onClick?: () => void; active?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
      } ${onClick ? 'cursor-pointer' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          className="ml-0.5 text-[10px] leading-none hover:text-red-500"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          aria-label={`Remove tag ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

/* ── Tag Editor ── */

function TagEditor({ templateId, tags, onUpdate }: { templateId: string; tags: string[]; onUpdate: () => void }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const commitTag = () => {
    const t = draft.trim().toLowerCase()
    if (t) { addTemplateTag(templateId, t); onUpdate() }
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <TagPill key={tag} tag={tag} onRemove={() => { removeTemplateTag(templateId, tag); onUpdate() }} />
      ))}
      {adding ? (
        <input
          type="text"
          className="w-16 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] outline-none focus:border-violet-400 dark:border-zinc-600 dark:bg-zinc-800"
          value={draft}
          autoFocus
          placeholder="tag…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTag}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTag()
            if (e.key === 'Escape') { setDraft(''); setAdding(false) }
          }}
          list="ag-suggested-tags"
        />
      ) : (
        <button
          type="button"
          className="rounded-full border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:hover:border-zinc-500"
          onClick={() => setAdding(true)}
          title="Add tag"
        >
          +
        </button>
      )}
      <datalist id="ag-suggested-tags">
        {SUGGESTED_TAGS.filter((s) => !tags.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}

/* ── Template Card ── */

function TemplateCard({
  template, thumbnail, tags, onDuplicate, onTagUpdate, duplicating,
}: {
  template: TemplateDto; thumbnail: string | null; tags: string[]
  onDuplicate: () => void; onTagUpdate: () => void; duplicating: boolean
}) {
  const { canEdit, canCreateTemplates } = usePermissions()
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600">
      {/* Status badge */}
      <div className="absolute left-2 top-2 z-10">
        <Badge variant="warning" size="sm" dot>Draft</Badge>
      </div>

      {/* Thumbnail */}
      <Link to={`/editor/${template.id}`} className="block">
        <div className="flex h-40 items-center justify-center overflow-hidden bg-zinc-50 dark:bg-zinc-800/50">
          {thumbnail ? (
            <img src={thumbnail} alt={`${template.name} preview`} className="h-full w-full object-contain object-top p-1" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-zinc-300 dark:text-zinc-600">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span className="text-[10px]">No preview</span>
            </div>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-3">
        <Link to={`/editor/${template.id}`} className="text-sm font-semibold text-zinc-900 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400 line-clamp-1">
          {template.name}
        </Link>
        {template.productName && (
          <span className="inline-flex w-fit items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
            {template.productName}
          </span>
        )}
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {new Date(template.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        </span>
        {canEdit && <TagEditor templateId={template.id} tags={tags} onUpdate={onTagUpdate} />}
        {!canEdit && tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>)}
          </div>
        )}
      </div>

      {/* Hover actions — only for users who can clone */}
      {canCreateTemplates && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="rounded-lg bg-white/90 p-1.5 text-zinc-500 shadow-sm backdrop-blur hover:bg-white hover:text-violet-600 dark:bg-zinc-800/90 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-violet-400"
            title="Duplicate template"
            disabled={duplicating}
            onClick={(e) => { e.preventDefault(); onDuplicate() }}
          >
            {duplicating ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Template Row ── */

function TemplateRow({
  template, tags, onDuplicate, onTagUpdate, duplicating,
}: {
  template: TemplateDto; tags: string[]
  onDuplicate: () => void; onTagUpdate: () => void; duplicating: boolean
}) {
  const { canEdit, canCreateTemplates } = usePermissions()
  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-900/20">
        <svg className="h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <Link to={`/editor/${template.id}`} className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400">{template.name}</span>
        {template.productName && (
          <span className="text-[11px] text-violet-600 dark:text-violet-400">
            {template.productName}
          </span>
        )}
      </Link>
      <Badge variant="warning" size="sm" className="hidden sm:inline-flex">Draft</Badge>
      <div className="hidden shrink-0 md:block">
        {canEdit ? (
          <TagEditor templateId={template.id} tags={tags} onUpdate={onTagUpdate} />
        ) : tags.length > 0 ? (
          <div className="flex gap-1">
            {tags.map((tag) => <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>)}
          </div>
        ) : null}
      </div>
      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
        {new Date(template.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </span>
      {canCreateTemplates && (
        <button
          type="button"
          className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-violet-600 dark:hover:bg-zinc-800 dark:hover:text-violet-400"
          title="Duplicate template"
          disabled={duplicating}
          onClick={() => onDuplicate()}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      )}
    </li>
  )
}

/* ── View Toggle ── */

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const btn = (m: ViewMode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        mode === m
          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800'
      }`}
      title={label}
      aria-label={label}
      onClick={() => onChange(m)}
    >
      {icon}
    </button>
  )

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
      {btn('grid', 'Grid view',
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
      )}
      {btn('list', 'List view',
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )}
    </div>
  )
}

/* ── Main Gallery Page ── */

export function TemplateList() {
  const navigate = useNavigate()
  const toast = useToast()
  const { canCreateTemplates, isAdmin } = usePermissions()
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  // Products loaded once per org — used by the filter dropdown above the
  // grid and by the create-modal product picker.
  const [products, setProducts] = useState<ProductDto[]>([])
  const [filterProductId, setFilterProductId] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  // Inline-new-product UX inside the create modal: admins can key in a new
  // product without leaving the flow.
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('agreemint-gallery-view') as ViewMode) ?? 'grid'
  )
  const [search, setSearch] = useState('')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOption>('newest')
  const [tagVersion, setTagVersion] = useState(0)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const createInputRef = useRef<HTMLInputElement>(null)

  const tagMap = useMemo(() => getAllTemplateTags(), [tagVersion])
  const usedTags = useMemo(() => allUsedTags(), [tagVersion])
  const refreshTags = useCallback(() => setTagVersion((v) => v + 1), [])

  const load = () => {
    setLoading(true)
    fetchTemplates()
      .then((list) => { setTemplates(list); setThumbnails(getAllThumbnails()) })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load templates'))
      .finally(() => setLoading(false))
  }

  const loadProducts = useCallback(() => {
    if (!orgId) return
    fetchProducts(orgId)
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [orgId])

  useEffect(() => { load() }, [])
  useEffect(() => { loadProducts() }, [loadProducts])

  const onViewChange = (m: ViewMode) => {
    setViewMode(m)
    localStorage.setItem('agreemint-gallery-view', m)
  }

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !selectedProductId) return
    setCreating(true)
    try {
      const t = await createTemplate(name.trim(), selectedProductId)
      setName('')
      setSelectedProductId('')
      setShowCreateModal(false)
      toast.success(`Template "${t.name}" created`)
      navigate(`/editor/${t.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  /** Inline-create a product from the template modal (ADMIN only). The new
   *  product is immediately selected so the admin can finish the template
   *  flow without closing the modal. */
  const onCreateInlineProduct = async () => {
    if (!orgId || !newProductName.trim()) return
    setCreatingProduct(true)
    try {
      const p = await createProduct(orgId, newProductName.trim())
      setProducts((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedProductId(p.id)
      setNewProductName('')
      setShowNewProduct(false)
      toast.success(`Product "${p.name}" created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Product create failed')
    } finally {
      setCreatingProduct(false)
    }
  }

  const onDuplicate = async (t: TemplateDto) => {
    if (!t.productId) {
      toast.error('Legacy template with no product — assign one first')
      return
    }
    setDuplicatingId(t.id)
    try {
      const newT = await duplicateTemplate(t.id, t.name, t.productId)
      toast.success(`Duplicated as "${newT.name}"`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duplicate failed')
    } finally {
      setDuplicatingId(null)
    }
  }

  // Filter + sort
  const filtered = useMemo(() => {
    let list = templates
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => t.name.toLowerCase().includes(q))
    }
    if (filterTag) {
      list = list.filter((t) => (tagMap[t.id] ?? []).includes(filterTag))
    }
    if (filterProductId) {
      list = list.filter((t) => t.productId === filterProductId)
    }
    return sortTemplates(list, sort)
  }, [templates, search, filterTag, filterProductId, tagMap, sort])

  return (
    <div className="page-enter mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Templates</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {templates.length} template{templates.length !== 1 ? 's' : ''} in your workspace
          </p>
        </div>
        {canCreateTemplates && (
          <Button
            variant="primary"
            onClick={() => { setShowCreateModal(true); setTimeout(() => createInputRef.current?.focus(), 100) }}
            icon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            New Template
          </Button>
        )}
      </div>

      {/* Toolbar: search + sort + tag filter + view toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Product filter — shown only once there's at least one product to
            avoid an empty dropdown on fresh orgs. */}
        {products.length > 0 && (
          <select
            value={filterProductId ?? ''}
            onChange={(e) => setFilterProductId(e.target.value || null)}
            aria-label="Filter by product"
            className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {/* Tag filters */}
        {usedTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {filterTag && (
              <button
                type="button"
                className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"
                onClick={() => setFilterTag(null)}
              >
                Clear
              </button>
            )}
            {usedTags.map((tag) => (
              <TagPill key={tag} tag={tag} active={filterTag === tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)} />
            ))}
          </div>
        )}

        <ViewToggle mode={viewMode} onChange={onViewChange} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} className="h-52" />)}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Create your first template to start building beautiful agreements"
          icon={
            <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
          action={{ label: 'Create template', onClick: () => setShowCreateModal(true) }}
          className="py-20"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No templates match"
          description={search ? `No results for "${search}"` : 'Try clearing your tag filter'}
          icon={
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          }
          action={{ label: 'Clear filters', onClick: () => { setSearch(''); setFilterTag(null) }, variant: 'secondary' }}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              thumbnail={thumbnails[t.id] ?? null}
              tags={tagMap[t.id] ?? []}
              duplicating={duplicatingId === t.id}
              onDuplicate={() => void onDuplicate(t)}
              onTagUpdate={refreshTags}
            />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
          {filtered.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              tags={tagMap[t.id] ?? []}
              duplicating={duplicatingId === t.id}
              onDuplicate={() => void onDuplicate(t)}
              onTagUpdate={refreshTags}
            />
          ))}
        </ul>
      )}

      {/* Count footer */}
      {!loading && templates.length > 0 && (
        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
          Showing {filtered.length} of {templates.length} template{templates.length !== 1 ? 's' : ''}
          {filterTag ? ` tagged "${filterTag}"` : ''}
          {search.trim() ? ` matching "${search.trim()}"` : ''}
        </p>
      )}

      {/* Create Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false); setName(''); setSelectedProductId('')
          setShowNewProduct(false); setNewProductName('')
        }}
        title="Create new template"
        description="Pick the product this template belongs to, then give it a name"
        size="sm"
      >
        <form onSubmit={(e) => void onCreate(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Product <span className="text-red-500">*</span>
            </label>
            {products.length === 0 ? (
              isAdmin ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                  You don't have any products yet. Create one below to continue.
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                  Your admin hasn't created any products yet. Ask them to add one from
                  Settings → Products before creating a template.
                </div>
              )
            ) : (
              <div className="flex gap-2">
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  required
                  className="h-9 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="" disabled>Select a product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowNewProduct((v) => !v)}
                    className="rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    + New
                  </button>
                )}
              </div>
            )}

            {/* Inline product-create — admin-only, appears either when
                toggled or when there are zero products. */}
            {isAdmin && (showNewProduct || products.length === 0) && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="New product name (e.g. Home Loans)"
                  className="h-9 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <Button
                  variant="secondary"
                  size="xs"
                  type="button"
                  loading={creatingProduct}
                  disabled={!newProductName.trim()}
                  onClick={() => void onCreateInlineProduct()}
                >
                  Create product
                </Button>
              </div>
            )}
          </div>

          <Input
            ref={createInputRef}
            label="Template name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Invoice, NDA, Proposal…"
          />
          <ModalFooter>
            <Button variant="secondary" size="sm" type="button" onClick={() => { setShowCreateModal(false); setName(''); setSelectedProductId('') }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={creating} disabled={!name.trim() || !selectedProductId}>
              Create
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  )
}
