import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createTemplate, duplicateTemplate, fetchTemplates, type TemplateDto } from '../lib/api'
import {
  addTemplateTag,
  allUsedTags,
  getAllTemplateTags,
  removeTemplateTag,
  SUGGESTED_TAGS,
} from '../lib/templateTags'
import { getAllThumbnails } from '../lib/templateThumbnails'

type ViewMode = 'grid' | 'list'

/* ------------------------------------------------------------------ */
/*  Tag Pill                                                          */
/* ------------------------------------------------------------------ */
function TagPill({
  tag,
  onRemove,
  onClick,
  active,
}: {
  tag: string
  onRemove?: () => void
  onClick?: () => void
  active?: boolean
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

/* ------------------------------------------------------------------ */
/*  Tag Editor (inline on cards)                                      */
/* ------------------------------------------------------------------ */
function TagEditor({
  templateId,
  tags,
  onUpdate,
}: {
  templateId: string
  tags: string[]
  onUpdate: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const commitTag = () => {
    const t = draft.trim().toLowerCase()
    if (t) {
      addTemplateTag(templateId, t)
      onUpdate()
    }
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <TagPill
          key={tag}
          tag={tag}
          onRemove={() => { removeTemplateTag(templateId, tag); onUpdate() }}
        />
      ))}
      {adding ? (
        <input
          ref={inputRef}
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
      {/* Suggested tags datalist */}
      <datalist id="ag-suggested-tags">
        {SUGGESTED_TAGS.filter((s) => !tags.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Template Card (grid mode)                                         */
/* ------------------------------------------------------------------ */
function TemplateCard({
  template,
  thumbnail,
  tags,
  onDuplicate,
  onTagUpdate,
  duplicating,
}: {
  template: TemplateDto
  thumbnail: string | null
  tags: string[]
  onDuplicate: () => void
  onTagUpdate: () => void
  duplicating: boolean
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      {/* Thumbnail / placeholder */}
      <Link to={`/editor/${template.id}`} className="block">
        <div className="flex h-36 items-center justify-center overflow-hidden bg-zinc-50 dark:bg-zinc-800/50">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={`${template.name} preview`}
              className="h-full w-full object-contain object-top p-1"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-zinc-300 dark:text-zinc-600">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span className="text-[10px]">No preview</span>
            </div>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        <Link
          to={`/editor/${template.id}`}
          className="text-sm font-semibold text-zinc-900 hover:text-violet-600 dark:text-zinc-100 dark:hover:text-violet-400"
        >
          {template.name}
        </Link>
        <span className="text-[10px] text-zinc-400">
          {new Date(template.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <TagEditor templateId={template.id} tags={tags} onUpdate={onTagUpdate} />
      </div>

      {/* Actions overlay */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          className="rounded-md bg-white/90 p-1 text-zinc-500 shadow-sm hover:bg-white hover:text-violet-600 dark:bg-zinc-800/90 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-violet-400"
          title="Duplicate template"
          disabled={duplicating}
          onClick={(e) => { e.preventDefault(); onDuplicate() }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Template Row (list mode)                                          */
/* ------------------------------------------------------------------ */
function TemplateRow({
  template,
  tags,
  onDuplicate,
  onTagUpdate,
  duplicating,
}: {
  template: TemplateDto
  tags: string[]
  onDuplicate: () => void
  onTagUpdate: () => void
  duplicating: boolean
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/80">
      <Link
        to={`/editor/${template.id}`}
        className="min-w-0 flex-1"
      >
        <span className="block font-medium text-zinc-900 dark:text-zinc-100">{template.name}</span>
      </Link>
      <div className="hidden shrink-0 sm:block">
        <TagEditor templateId={template.id} tags={tags} onUpdate={onTagUpdate} />
      </div>
      <span className="shrink-0 text-xs text-zinc-500">
        {new Date(template.createdAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </span>
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-violet-600 dark:hover:bg-zinc-800 dark:hover:text-violet-400"
        title="Duplicate template"
        disabled={duplicating}
        onClick={() => onDuplicate()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/*  View Toggle                                                       */
/* ------------------------------------------------------------------ */
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
      {btn(
        'grid',
        'Grid view',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
      )}
      {btn(
        'list',
        'List view',
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Gallery Page                                                 */
/* ------------------------------------------------------------------ */
export function TemplateList() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('agreemint-gallery-view') as ViewMode) ?? 'grid'
  })
  const [search, setSearch] = useState('')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [tagVersion, setTagVersion] = useState(0)

  // Thumbnail cache
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  // Tag data
  const tagMap = useMemo(() => getAllTemplateTags(), [tagVersion])
  const usedTags = useMemo(() => allUsedTags(), [tagVersion])

  const refreshTags = useCallback(() => setTagVersion((v) => v + 1), [])

  const load = () => {
    setLoading(true)
    setError(null)
    fetchTemplates()
      .then((list) => {
        setTemplates(list)
        setThumbnails(getAllThumbnails())
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const onViewChange = (m: ViewMode) => {
    setViewMode(m)
    localStorage.setItem('agreemint-gallery-view', m)
  }

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const t = await createTemplate(name.trim())
      setName('')
      navigate(`/editor/${t.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  const onDuplicate = async (t: TemplateDto) => {
    setDuplicatingId(t.id)
    setError(null)
    try {
      await duplicateTemplate(t.id, t.name)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplicate failed')
    } finally {
      setDuplicatingId(null)
    }
  }

  // Filtered templates
  const filtered = useMemo(() => {
    let list = templates
    // Search by name
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((t) => t.name.toLowerCase().includes(q))
    }
    // Filter by tag
    if (filterTag) {
      list = list.filter((t) => (tagMap[t.id] ?? []).includes(filterTag))
    }
    return list
  }, [templates, search, filterTag, tagMap])

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Agreemint</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Visual PDF templates with versioned layouts and iText rendering.
          </p>
        </div>
      </div>

      {/* Create form */}
      <form onSubmit={(e) => void onCreate(e)} className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">New template name</span>
          <input
            id="ag-template-new-name"
            name="ag-template-new-name"
            type="text"
            className="min-w-[240px] rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Invoice, NDA, …"
          />
        </label>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {/* Toolbar: search + tag filter + view toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Tag filters */}
        {usedTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Filter:</span>
            {filterTag && (
              <button
                type="button"
                className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"
                onClick={() => setFilterTag(null)}
              >
                All
              </button>
            )}
            {usedTags.map((tag) => (
              <TagPill
                key={tag}
                tag={tag}
                active={filterTag === tag}
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              />
            ))}
          </div>
        )}

        <ViewToggle mode={viewMode} onChange={onViewChange} />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-zinc-500">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-zinc-300 dark:text-zinc-600">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No templates yet. Create one above.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No templates match your search.</p>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-900">
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
        <p className="mt-4 text-[11px] text-zinc-400">
          {filtered.length} of {templates.length} template{templates.length !== 1 ? 's' : ''}
          {filterTag ? ` tagged "${filterTag}"` : ''}
          {search.trim() ? ` matching "${search.trim()}"` : ''}
        </p>
      )}
    </div>
  )
}
