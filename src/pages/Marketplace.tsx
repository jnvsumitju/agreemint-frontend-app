import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../lib/api'

/* ── Types ── */

interface MarketplaceListing {
  id: string
  type: string
  title: string
  description: string | null
  authorName: string | null
  thumbnailUrl: string | null
  category: string | null
  tags: string | null
  installCount: number
  createdAt: string
}

/* ── Constants ── */

const CATEGORIES = ['Contracts', 'Legal', 'HR', 'Finance', 'Marketing', 'Other'] as const

/* ── Listing Card ── */

function ListingCard({
  listing,
  onClone,
  cloning,
}: {
  listing: MarketplaceListing
  onClone: () => void
  cloning: boolean
}) {
  const excerpt =
    listing.description && listing.description.length > 100
      ? listing.description.slice(0, 100) + '...'
      : listing.description

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      {/* Thumbnail */}
      <div className="flex h-36 items-center justify-center bg-zinc-50 dark:bg-zinc-800/50">
        {listing.thumbnailUrl ? (
          <img
            src={listing.thumbnailUrl}
            alt={`${listing.title} thumbnail`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-zinc-300 dark:text-zinc-600">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span className="text-[10px]">Template</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{listing.title}</h3>
        {excerpt && (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{excerpt}</p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {listing.authorName && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                by {listing.authorName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {listing.installCount}
          </div>
        </div>

        {listing.category && (
          <span className="inline-block self-start rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {listing.category}
          </span>
        )}

        <button
          type="button"
          disabled={cloning}
          onClick={onClone}
          className="mt-2 w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {cloning ? 'Cloning...' : 'Use Template'}
        </button>
      </div>
    </div>
  )
}

/* ── Main Marketplace ── */

export function Marketplace() {
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [cloneSuccess, setCloneSuccess] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await authFetch('/api/marketplace')
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json()
            setListings(data)
          } else {
            setError('Failed to load marketplace listings')
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load marketplace listings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    let result = listings

    if (activeCategory) {
      result = result.filter(
        (l) => l.category?.toLowerCase() === activeCategory.toLowerCase()
      )
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          (l.description?.toLowerCase().includes(q) ?? false) ||
          (l.authorName?.toLowerCase().includes(q) ?? false) ||
          (l.tags?.toLowerCase().includes(q) ?? false)
      )
    }

    return result
  }, [listings, activeCategory, search])

  async function handleClone(listingId: string) {
    setCloningId(listingId)
    setCloneSuccess(null)
    try {
      const res = await authFetch(`/api/marketplace/${listingId}/clone`, {
        method: 'POST',
      })
      if (res.ok) {
        setCloneSuccess(listingId)
        // Refresh listings to update install count
        const refreshRes = await authFetch('/api/marketplace')
        if (refreshRes.ok) {
          const data = await refreshRes.json()
          setListings(data)
        }
        setTimeout(() => setCloneSuccess(null), 3000)
      } else {
        setError('Failed to clone template')
      }
    } catch {
      setError('Failed to clone template')
    } finally {
      setCloningId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Marketplace</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Browse and install community templates
          </p>
        </div>
        <div className="relative min-w-[240px]">
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
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Success banner */}
      {cloneSuccess && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          Template cloned successfully! Check your templates list.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-8">
        {/* Filter sidebar */}
        <aside className="hidden w-48 shrink-0 lg:block">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Categories
          </h3>
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activeCategory === null
                  ? 'bg-violet-100 font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              All
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeCategory === cat
                    ? 'bg-violet-100 font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile category filters */}
        <div className="mb-4 flex flex-wrap gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeCategory === null
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Listing grid */}
        <div className="flex-1">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="mx-auto mb-3 text-zinc-300 dark:text-zinc-600"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {listings.length === 0
                  ? 'No marketplace listings available yet'
                  : 'No listings match your search'}
              </p>
              {(search || activeCategory) && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setActiveCategory(null) }}
                  className="mt-2 text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  cloning={cloningId === listing.id}
                  onClone={() => void handleClone(listing.id)}
                />
              ))}
            </div>
          )}

          {/* Count footer */}
          {!loading && listings.length > 0 && (
            <p className="mt-4 text-[11px] text-zinc-400">
              {filtered.length} of {listings.length} listing{listings.length !== 1 ? 's' : ''}
              {activeCategory ? ` in ${activeCategory}` : ''}
              {search.trim() ? ` matching "${search.trim()}"` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
