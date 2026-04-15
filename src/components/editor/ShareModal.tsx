import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '../../lib/api'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Badge } from '../ui/Badge'
import { useToast } from '../ui/Toast'

/* ── Types ── */

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

const ROLE_OPTIONS = [
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'REVIEWER', label: 'Reviewer' },
  { value: 'DESIGNER', label: 'Designer' },
  { value: 'ADMIN', label: 'Admin' },
]

const EXPIRY_OPTIONS = [
  { value: '0', label: 'Never expires' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
]

/* ── Component ── */

export function ShareModal({ open, onClose, templateId }: { open: boolean; onClose: () => void; templateId: string }) {
  const toast = useToast()
  const [tab, setTab] = useState<'people' | 'link'>('people')
  const [shares, setShares] = useState<ShareDto[]>([])
  const [loading, setLoading] = useState(false)

  // People tab state
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('VIEWER')
  const [sharing, setSharing] = useState(false)

  // Link tab state
  const [linkRole, setLinkRole] = useState('VIEWER')
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
    }
  }, [open, fetchShares])

  async function handleShareWithUser(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSharing(true)
    try {
      const res = await authFetch(`/api/templates/${templateId}/shares/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to share' }))
        throw new Error(data.error || 'Failed to share')
      }
      toast.success(`Shared with ${email.trim()}`)
      setEmail('')
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
        body: JSON.stringify({ role: linkRole, expiresInHours: linkExpiry === '0' ? null : parseInt(linkExpiry) }),
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

  const roleBadgeVariant = (r: string) => {
    switch (r) {
      case 'ADMIN': return 'primary' as const
      case 'DESIGNER': return 'info' as const
      case 'REVIEWER': return 'warning' as const
      default: return 'default' as const
    }
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
          {/* Invite form */}
          <form onSubmit={(e) => void handleShareWithUser(e)} className="flex items-end gap-2">
            <Input
              label="Email address"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="flex-1"
              size="sm"
            />
            <Select
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={ROLE_OPTIONS}
              className="w-32"
              size="sm"
            />
            <Button type="submit" size="sm" loading={sharing} disabled={!email.trim()}>
              Share
            </Button>
          </form>

          {/* Existing shares */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              People with access
            </p>
            {loading ? (
              <div className="py-4 text-center text-sm text-zinc-400">Loading...</div>
            ) : shares.filter((s) => s.sharedWithEmail).length === 0 ? (
              <div className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                No one has been invited yet
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
                    <Badge variant={roleBadgeVariant(s.role)} size="sm">{s.role}</Badge>
                    <button
                      onClick={() => void handleRevoke(s.id)}
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title="Revoke access"
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
          {/* Link generation */}
          <div className="flex items-end gap-2">
            <Select
              label="Anyone with the link can"
              value={linkRole}
              onChange={(e) => setLinkRole(e.target.value)}
              options={ROLE_OPTIONS}
              className="flex-1"
              size="sm"
            />
            <Select
              label="Expires"
              value={linkExpiry}
              onChange={(e) => setLinkExpiry(e.target.value)}
              options={EXPIRY_OPTIONS}
              className="w-36"
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

          {/* Generated link */}
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
                    <div className="min-w-0 flex-1">
                      <Badge variant={roleBadgeVariant(s.role)} size="sm">{s.role}</Badge>
                      {s.expiresAt && (
                        <span className="ml-2 text-xs text-zinc-400">
                          expires {new Date(s.expiresAt).toLocaleDateString()}
                        </span>
                      )}
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
