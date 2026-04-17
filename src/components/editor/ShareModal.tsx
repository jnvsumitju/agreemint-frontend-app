import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authFetch, fetchOrgMembers, type OrgMemberDto } from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'

/**
 * Simplified Share modal.
 *
 * - "Share with people": email field is an autocomplete combobox over org members.
 *   No role selector; the share is a pointer + notification (recipient's actual
 *   access is governed by their org membership). On Done the backend sends an
 *   email + in-app notification with a link.
 * - "Share via link": no role selector, expiry only.
 */

interface ShareDto {
  id: string
  templateId: string
  sharedWithEmail: string | null
  sharedWithUserId: string | null
  role: string
  shareToken: string | null
  expiresAt: string | null
  createdAt: string
}

const EXPIRY_OPTIONS = [
  { value: '0', label: 'Never expires' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
]

export function ShareModal({ open, onClose, templateId }: { open: boolean; onClose: () => void; templateId: string }) {
  const toast = useToast()
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const [tab, setTab] = useState<'people' | 'link'>('people')
  const [shares, setShares] = useState<ShareDto[]>([])
  const [loading, setLoading] = useState(false)

  // ── People tab
  const [email, setEmail] = useState('')
  const [members, setMembers] = useState<OrgMemberDto[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [sharing, setSharing] = useState(false)
  const comboRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // ── Link tab
  const [linkExpiry, setLinkExpiry] = useState('168')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchShares = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/templates/${templateId}/shares`)
      if (res.ok) setShares(await res.json())
    } catch (err) {
      console.error('[ShareModal] Failed to load shares:', err)
    } finally {
      setLoading(false)
    }
  }, [templateId])

  useEffect(() => {
    if (open) {
      fetchShares()
      setGeneratedLink(null)
      setCopied(false)
      if (orgId) {
        fetchOrgMembers(orgId).then(setMembers).catch(() => setMembers([]))
      }
    }
  }, [open, fetchShares, orgId])

  // Close suggestions on outside click
  useEffect(() => {
    if (!suggestOpen) return
    const onDown = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setSuggestOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [suggestOpen])

  const suggestions = useMemo(() => {
    const q = email.trim().toLowerCase()
    if (!q) return members.slice(0, 10)
    return members
      .filter((m) => m.email.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 10)
  }, [email, members])

  const pickSuggestion = (m: OrgMemberDto) => {
    setEmail(m.email)
    setSuggestOpen(false)
    setActiveIdx(0)
    inputRef.current?.focus()
  }

  async function handleShareWithUser(e: React.FormEvent) {
    e.preventDefault()
    const target = email.trim()
    if (!target) return
    setSharing(true)
    try {
      const res = await authFetch(`/api/templates/${templateId}/shares/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to share' }))
        throw new Error(data.error || 'Failed to share')
      }
      toast.success(`Shared with ${target}`)
      setEmail('')
      setSuggestOpen(false)
      fetchShares()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to share')
    } finally {
      setSharing(false)
    }
  }

  async function handleGenerateLink() {
    setGenerating(true)
    try {
      const res = await authFetch(`/api/templates/${templateId}/shares/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInHours: linkExpiry === '0' ? null : parseInt(linkExpiry) }),
      })
      if (!res.ok) throw new Error('Failed to generate link')
      const data: ShareDto = await res.json()
      const link = `${window.location.origin}/shared?token=${data.shareToken}`
      setGeneratedLink(link)
      fetchShares()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate link')
    } finally {
      setGenerating(false)
    }
  }

  async function handleRevoke(shareId: string) {
    try {
      await authFetch(`/api/templates/${templateId}/shares/${shareId}`, { method: 'DELETE' })
      toast.success('Share revoked')
      setShares((prev) => prev.filter((s) => s.id !== shareId))
    } catch {
      toast.error('Failed to revoke share')
    }
  }

  function copyLink() {
    if (!generatedLink) return
    navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('')
  }

  return (
    <Modal open={open} onClose={onClose} title="Share template" size="lg">
      {/* Tabs */}
      <div className="mb-5 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {(['people', 'link'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {t === 'people' ? 'Share with people' : 'Share via link'}
          </button>
        ))}
      </div>

      {tab === 'people' ? (
        <>
          <form onSubmit={(e) => void handleShareWithUser(e)} className="flex items-end gap-2">
            <div className="relative flex-1" ref={comboRef}>
              <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Share with
              </label>
              <input
                ref={inputRef}
                type="text"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setSuggestOpen(true)
                  setActiveIdx(0)
                }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={(e) => {
                  if (!suggestOpen || suggestions.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIdx((i) => Math.max(i - 1, 0))
                  } else if (e.key === 'Enter' && suggestions[activeIdx]) {
                    e.preventDefault()
                    pickSuggestion(suggestions[activeIdx])
                  } else if (e.key === 'Escape') {
                    setSuggestOpen(false)
                  }
                }}
                placeholder="Name or email address"
                className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                autoComplete="off"
              />
              {suggestOpen && suggestions.length > 0 && (
                <ul
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
                  role="listbox"
                >
                  {suggestions.map((m, idx) => (
                    <li
                      key={m.userId}
                      role="option"
                      aria-selected={idx === activeIdx}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pickSuggestion(m)
                      }}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                        idx === activeIdx
                          ? 'bg-violet-50 text-zinc-900 dark:bg-violet-900/30 dark:text-zinc-100'
                          : 'text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-700/60'
                      }`}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                        {initials(m.name || m.email)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.name || m.email}</div>
                        {m.name && <div className="truncate text-[11px] text-zinc-500">{m.email}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="submit" size="sm" loading={sharing} disabled={!email.trim()}>
              Share &amp; notify
            </Button>
          </form>

          <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            They'll receive an email and an in-app notification with a link to the template.
          </p>

          {/* Existing shares */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              People notified
            </p>
            {loading ? (
              <div className="py-4 text-center text-sm text-zinc-400">Loading...</div>
            ) : shares.filter((s) => s.sharedWithEmail).length === 0 ? (
              <div className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                No one has been notified yet
              </div>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {shares.filter((s) => s.sharedWithEmail).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      {s.sharedWithEmail!.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">{s.sharedWithEmail}</p>
                    </div>
                    <button
                      onClick={() => void handleRevoke(s.id)}
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title="Remove from list"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Link generation — no role, expiry only */}
          <div className="flex items-end gap-2">
            <Select
              label="Expires"
              value={linkExpiry}
              onChange={(e) => setLinkExpiry(e.target.value)}
              options={EXPIRY_OPTIONS}
              className="flex-1"
              size="sm"
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            className="mt-4 w-full"
            loading={generating}
            onClick={() => void handleGenerateLink()}
          >
            Generate share link
          </Button>

          {generatedLink && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
              <input
                type="text"
                readOnly
                value={generatedLink}
                className="flex-1 truncate bg-transparent text-sm text-zinc-700 outline-none dark:text-zinc-300"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button variant="secondary" size="xs" onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          )}

          {/* Existing links */}
          {shares.filter((s) => s.shareToken).length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Active share links
              </p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {shares.filter((s) => s.shareToken).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    <div className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-300">
                      {s.expiresAt ? `expires ${new Date(s.expiresAt).toLocaleDateString()}` : 'never expires'}
                    </div>
                    <button
                      onClick={() => void handleRevoke(s.id)}
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title="Revoke link"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
      </ModalFooter>
    </Modal>
  )
}
