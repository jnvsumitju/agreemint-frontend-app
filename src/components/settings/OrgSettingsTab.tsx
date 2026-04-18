import { useState, useRef } from 'react'
import { useAuthStore, type OrgDto } from '../../stores/authStore'
import { authFetch, uploadOrgLogo } from '../../lib/api'

export function OrgSettingsTab() {
  const org = useAuthStore((s) => s.org)
  const orgs = useAuthStore((s) => s.orgs)
  const setOrg = useAuthStore((s) => s.setOrg)

  const entry = orgs.find((e) => e.org.id === org?.id)
  const isAdmin = entry?.role === 'ADMIN'

  const [name, setName] = useState(org?.name ?? '')
  const [logoPreview, setLogoPreview] = useState(org?.logoUrl ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  // Logo is uploaded immediately — the backend persists the public R2 URL
  // and returns it; the "Save changes" button only covers name edits now.
  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !org) return
    e.target.value = ''
    const MAX_SIZE = 2 * 1024 * 1024 // 2MB
    if (file.size > MAX_SIZE) {
      showToast('error', 'Logo image must be under 2MB')
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast('error', 'Use PNG, JPEG, or WebP')
      return
    }
    setLogoUploading(true)
    try {
      const url = await uploadOrgLogo(org.id, file)
      setLogoPreview(url)
      setOrg({ ...org, logoUrl: url })
      showToast('success', 'Logo updated')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  async function saveOrg() {
    if (!org) return
    setSaving(true)
    try {
      const res = await authFetch(`/api/orgs/${org.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Update failed' }))
        throw new Error(err.message || 'Update failed')
      }
      const updated: OrgDto = { ...org, name }
      setOrg(updated)
      showToast('success', 'Organization updated')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  const planBadge: Record<string, { color: string }> = {
    FREE: { color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' },
    PRO: { color: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
    ENTERPRISE: { color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  }

  if (!org) return null

  const badge = planBadge[org.plan] ?? planBadge.FREE

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-16 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          Only admins can edit organization settings.
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">Organization details</h2>

        {/* Logo */}
        <div className="mb-6 flex items-center gap-4">
          {logoPreview ? (
            <img
              src={logoPreview}
              alt=""
              className="h-16 w-16 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-zinc-200 bg-violet-50 text-xl font-bold text-violet-600 dark:border-zinc-700 dark:bg-violet-900/30 dark:text-violet-400">
              {org.name.charAt(0).toUpperCase()}
            </div>
          )}
          {isAdmin && (
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={logoUploading}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {logoUploading ? 'Uploading…' : 'Change logo'}
              </button>
              {/*
                sr-only instead of `hidden` (display:none) — some Chrome
                builds block programmatic .click() on a display:none file
                input, which made the "Change logo" button silently do
                nothing.
              */}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void handleLogoChange(e)}
                className="sr-only"
              />
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="org-name"
              className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Organization name
            </label>
            <input
              id="org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/50 dark:disabled:text-zinc-500"
            />
          </div>

          {/* Slug (read-only) */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Slug
            </label>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
              {org.slug}
            </div>
          </div>

          {/* Plan */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Current plan
            </label>
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
              {org.plan}
            </span>
          </div>

          {isAdmin && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => void saveOrg()}
                disabled={saving || name === org.name}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
