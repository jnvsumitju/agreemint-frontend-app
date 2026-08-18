import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePermissions } from '../hooks/usePermissions'
import { templateStatus, templateStatusConfirm, templateVersionNote } from '../lib/templateStatus'
import { TemplateStatusControl } from '../components/templates/TemplateStatusControl'
import { usePlan } from '../hooks/usePlan'
import { PublishTemplateModal } from '../components/marketplace/PublishTemplateModal'
import { useEntitlements } from '../hooks/useEntitlements'
import { UpgradePrompt } from '../components/billing/UpgradePrompt'
import { useAuthStore } from '../stores/authStore'
import {
  createProduct,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  fetchProducts,
  fetchTemplates,
  setTemplateStatus,
  type ProductDto,
  type TemplateDto,
  type TemplateStatus,
} from '../lib/api'
import {
  addTemplateTag,
  allUsedTags,
  getAllTemplateTags,
  removeTemplateTag,
  SUGGESTED_TAGS,
} from '../lib/templateTags'
import { Button } from '../components/ui/Button'
import { useConfirm } from '../components/ui/ConfirmDialog'
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
  template, tags, onDuplicate, onDelete, onPublish, onTagUpdate, duplicating, deleting,
  onSetStatus, statusBusy,
}: {
  template: TemplateDto; tags: string[]
  onDuplicate: () => void; onDelete: () => void; onPublish: () => void; onTagUpdate: () => void
  onSetStatus: (next: TemplateStatus) => void; statusBusy: boolean
  duplicating: boolean; deleting: boolean
}) {
  const { canEdit, canCreateTemplates } = usePermissions()
  const { isFree } = usePlan()
  const canUseMarketplace = canCreateTemplates && !isFree
  const status = templateStatus(template)
  const versionNote = templateVersionNote(template)
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600">
      {/* Derived from committed versions and draft state — see templateStatus.
          This was a hardcoded "Draft" on every card, committed or not. */}
      <div className="absolute left-2 top-2 z-10">
        <div className="flex items-center gap-1">
          <Badge variant={status.tone} size="sm" dot title={status.title}>
            {status.label}
          </Badge>
          {/* Version state sits beside the lifecycle badge rather than
              replacing it: one says whether the template can be used, the
              other whether its committed output is current. */}
          {versionNote && (
            <span
              className="rounded-full bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 shadow-sm dark:bg-zinc-900/85 dark:text-zinc-300"
              title={versionNote.title}
            >
              {versionNote.label}
            </span>
          )}
        </div>
      </div>

      {/* Preview image. Rendered server-side from the same PDF pipeline the
          real documents come out of, so a card shows the document rather than
          a screenshot of the editor canvas — the canvas is deliberately not
          pixel-identical to the PDF. The URL is signed and short-lived, which
          is why it is read straight off the response instead of being cached. */}
      <Link to={`/editor/${template.id}`} className="block">
        <div className="flex h-40 items-center justify-center overflow-hidden bg-zinc-50 dark:bg-zinc-800/50">
          {template.thumbnailUrl ? (
            <img
              src={template.thumbnailUrl}
              alt={`${template.name} preview`}
              loading="lazy"
              className="h-full w-full object-contain object-top p-1"
            />
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
        <TemplateStatusControl
          status={template.status}
          busy={statusBusy}
          onChange={onSetStatus}
        />
        {canEdit && <TagEditor templateId={template.id} tags={tags} onUpdate={onTagUpdate} />}
        {!canEdit && tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>)}
          </div>
        )}
      </div>

      {/* Hover actions — only for users who can clone / delete (ADMIN, DESIGNER) */}
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
          {/* Marketplace is Starter+; the page itself is already gated, but the
              action is hidden rather than shown-then-402'd. */}
          {canUseMarketplace && (
            <button
              type="button"
              className="rounded-lg bg-white/90 p-1.5 text-zinc-500 shadow-sm backdrop-blur hover:bg-white hover:text-violet-600 dark:bg-zinc-800/90 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-violet-400"
              title="Publish to marketplace"
              onClick={(e) => { e.preventDefault(); onPublish() }}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="rounded-lg bg-white/90 p-1.5 text-zinc-500 shadow-sm backdrop-blur hover:bg-white hover:text-red-600 dark:bg-zinc-800/90 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete template"
            disabled={deleting || duplicating}
            onClick={(e) => { e.preventDefault(); onDelete() }}
          >
            {deleting ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1.36 13.6a2 2 0 01-2 1.8H8.36a2 2 0 01-2-1.8L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
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
  template, tags, onDuplicate, onDelete, onTagUpdate, duplicating, deleting,
  onSetStatus, statusBusy,
}: {
  template: TemplateDto; tags: string[]
  onDuplicate: () => void; onDelete: () => void; onTagUpdate: () => void
  onSetStatus: (next: TemplateStatus) => void; statusBusy: boolean
  duplicating: boolean; deleting: boolean
}) {
  const { canEdit, canCreateTemplates } = usePermissions()
  const status = templateStatus(template)
  const versionNote = templateVersionNote(template)
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
      <Badge variant={status.tone} size="sm" className="hidden sm:inline-flex" title={status.title}>
        {status.label}
      </Badge>
      {versionNote && (
        <span
          className="hidden text-[10px] font-medium text-zinc-500 sm:inline dark:text-zinc-400"
          title={versionNote.title}
        >
          {versionNote.label}
        </span>
      )}
      <TemplateStatusControl
        status={template.status}
        busy={statusBusy}
        onChange={onSetStatus}
        size="xs"
      />
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
        <>
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-violet-600 dark:hover:bg-zinc-800 dark:hover:text-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            title="Duplicate template"
            disabled={duplicating || deleting}
            onClick={() => onDuplicate()}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete template"
            disabled={deleting || duplicating}
            onClick={() => onDelete()}
          >
            {deleting ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1.36 13.6a2 2 0 01-2 1.8H8.36a2 2 0 01-2-1.8L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
              </svg>
            )}
          </button>
        </>
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
  // Free-plan template ceiling. Null while loading, and false for
  // grandfathered workspaces, so no spurious prompt appears.
  const { entitlements, atTemplateLimit } = useEntitlements()
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const authorName = useAuthStore((s) => s.user?.name ?? s.user?.email ?? 'Anonymous')
  // Deep-link support: `/templates?productId=...` (used by the Products page)
  // preloads the filter to that product.
  const [searchParams] = useSearchParams()
  const initialProductId = searchParams.get('productId')
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  /**
   * Delete confirmation flow: clicking the trash icon sets {@code deleteTarget}
   * (opens the modal); {@code deletingId} flips during the in-flight API call
   * so the row's spinner shows. Soft-resets after success/cancel.
   */
  const [deleteTarget, setDeleteTarget] = useState<TemplateDto | null>(null)
  const [publishTarget, setPublishTarget] = useState<TemplateDto | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Products loaded once per org — used by the filter dropdown above the
  // grid and by the create-modal product picker.
  const [products, setProducts] = useState<ProductDto[]>([])
  const [filterProductId, setFilterProductId] = useState<string | null>(initialProductId)
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
  const createInputRef = useRef<HTMLInputElement>(null)

  const tagMap = useMemo(() => getAllTemplateTags(), [tagVersion])
  const usedTags = useMemo(() => allUsedTags(), [tagVersion])
  const refreshTags = useCallback(() => setTagVersion((v) => v + 1), [])

  const load = () => {
    setLoading(true)
    fetchTemplates()
      .then(setTemplates)
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

  const confirmDelete = async () => {
    const t = deleteTarget
    if (!t) return
    setDeletingId(t.id)
    try {
      await deleteTemplate(t.id)
      toast.success(`Deleted "${t.name}"`)
      setDeleteTarget(null)
      // Optimistic: drop the row immediately; {@code load} confirms with the
      // backend and catches any race where two clients delete concurrently.
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  // Filter + sort
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const confirm = useConfirm()

  /**
   * Change a template's lifecycle state, after confirming.
   *
   * <p>Confirmed because every transition changes whether documents can be
   * generated — and two of the three break something that currently works, for
   * anyone whose integration holds this template's id. That consequence is
   * invisible from the button alone, so the dialog states it.
   *
   * <p>Updates the row in place from the server's response rather than
   * re-fetching the list: the response is the authoritative new state, and a
   * refetch would reorder or re-filter the list under the cursor of someone who
   * just clicked one button.
   *
   * <p>The failure is surfaced rather than only logged: the previous version
   * swallowed a rejected request into the console, leaving the badge unchanged
   * with no explanation — which reads exactly like a UI that ignored the click.
   */
  async function changeStatus(t: TemplateDto, next: TemplateStatus) {
    const copy = templateStatusConfirm(t.name, t.status, next)
    const ok = await confirm({
      title: copy.title,
      description: copy.description,
      confirmLabel: copy.confirmLabel,
      variant: copy.danger ? 'danger' : 'primary',
    })
    if (!ok) return

    setStatusBusyId(t.id)
    try {
      const updated = await setTemplateStatus(t.id, next)
      setTemplates((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e) {
      console.error('[Templates] status change failed:', e)
      setStatusError(
        e instanceof Error && e.message
          ? e.message
          : `Could not change the status of "${t.name}". Your role may not allow it.`
      )
    } finally {
      setStatusBusyId(null)
    }
  }

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
            {entitlements?.freeRestricted && entitlements.maxTemplates > 0 &&
              ` · ${entitlements.templateCount} of ${entitlements.maxTemplates} used`}
          </p>
        </div>
        {canCreateTemplates && (
          <Button
            variant="primary"
            disabled={atTemplateLimit}
            title={atTemplateLimit ? 'Free plan template limit reached' : undefined}
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

      {atTemplateLimit && (
        <div className="mb-6">
          <UpgradePrompt
            feature="More templates"
            requiredPlan="Starter"
            description={`The free plan is limited to ${entitlements?.maxTemplates ?? 10} templates. Upgrade for unlimited templates, or delete one you no longer need.`}
          />
        </div>
      )}

      {/* A refused status change has to be visible. The server gate is
          ADMIN/REVIEWER, so the most likely rejection is a role the UI thought
          was allowed — silently doing nothing would look like a dead button. */}
      {statusError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-xs text-red-700 dark:text-red-300">{statusError}</p>
          <button
            type="button"
            onClick={() => setStatusError(null)}
            className="shrink-0 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

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
              tags={tagMap[t.id] ?? []}
              duplicating={duplicatingId === t.id}
              deleting={deletingId === t.id}
              onDuplicate={() => void onDuplicate(t)}
              onDelete={() => setDeleteTarget(t)}
              onPublish={() => setPublishTarget(t)}
              onTagUpdate={refreshTags}
              onSetStatus={(next) => void changeStatus(t, next)}
              statusBusy={statusBusyId === t.id}
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
              deleting={deletingId === t.id}
              onDuplicate={() => void onDuplicate(t)}
              onDelete={() => setDeleteTarget(t)}
              onTagUpdate={refreshTags}
              onSetStatus={(next) => void changeStatus(t, next)}
              statusBusy={statusBusyId === t.id}
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

      {publishTarget && (
        <PublishTemplateModal
          open
          onClose={() => setPublishTarget(null)}
          templateId={publishTarget.id}
          templateName={publishTarget.name}
          authorName={authorName}
          onPublished={() => toast.success(`"${publishTarget.name}" is now listed in the marketplace`)}
        />
      )}

      {/* Delete confirmation — destructive action, explicit copy. Gated to
          ADMIN/DESIGNER via the trash-icon's canCreateTemplates check on the
          card/row; the modal just confirms intent. */}
      <Modal
        open={deleteTarget != null}
        onClose={() => { if (!deletingId) setDeleteTarget(null) }}
        title="Delete template?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" and every version, draft, review, and share link will be permanently removed. This cannot be undone.`
            : ''
        }
        size="sm"
      >
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={deletingId != null}
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            type="button"
            loading={deletingId != null}
            onClick={() => void confirmDelete()}
          >
            Delete template
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
