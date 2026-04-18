import { useState, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { authFetch, uploadUserAvatar } from '../lib/api'

export function Profile() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [name, setName] = useState(user?.name ?? '')
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl ?? '')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Password change (LOCAL provider only)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const isLocal = user?.provider === 'LOCAL'

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  function initials(n: string) {
    return n
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // The avatar is uploaded immediately on pick — it goes to R2 via our
  // backend, which returns the permanent public URL and writes it back to
  // the user row. "Save changes" is now just for name edits.
  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const MAX_SIZE = 2 * 1024 * 1024 // 2MB
    if (file.size > MAX_SIZE) {
      showToast('error', 'Image must be under 2MB')
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast('error', 'Use PNG, JPEG, or WebP')
      return
    }
    setAvatarUploading(true)
    try {
      const url = await uploadUserAvatar(file)
      setAvatarPreview(url)
      setUser({ avatarUrl: url })
      showToast('success', 'Avatar updated')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function saveProfile() {
    setSaving(true)
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Update failed' }))
        throw new Error(err.message || 'Update failed')
      }
      setUser({ name })
      showToast('success', 'Profile updated')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) {
      showToast('error', 'Passwords do not match')
      return
    }
    if (newPw.length < 8) {
      showToast('error', 'Password must be at least 8 characters')
      return
    }
    setPwSaving(true)
    try {
      const res = await authFetch('/api/auth/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Password change failed' }))
        throw new Error(err.message || 'Password change failed')
      }
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      showToast('success', 'Password changed')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Password change failed')
    } finally {
      setPwSaving(false)
    }
  }

  const providerBadge: Record<string, { label: string; color: string }> = {
    LOCAL: { label: 'Email', color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' },
    GOOGLE: { label: 'Google', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
    GITHUB: { label: 'GitHub', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  }
  const badge = providerBadge[user?.provider ?? 'LOCAL'] ?? providerBadge.LOCAL

  if (!user) return null

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-16 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <h1 className="mb-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Profile</h1>

      {/* Avatar + Name Card */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <div className="relative">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt=""
                className="h-20 w-20 rounded-full border-2 border-violet-200 object-cover dark:border-violet-700"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-violet-200 bg-violet-100 text-2xl font-semibold text-violet-700 dark:border-violet-700 dark:bg-violet-900 dark:text-violet-300">
                {initials(user.name)}
              </div>
            )}
          </div>
          <div>
            <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{user.name}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{user.email}</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={avatarUploading}
              className="mt-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {avatarUploading ? 'Uploading…' : 'Change avatar'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void handleAvatarChange(e)}
              className="hidden"
            />
          </div>
        </div>

        {/* Divider */}
        <div className="my-6 border-t border-zinc-100 dark:border-zinc-800" />

        {/* Name Field */}
        <div className="space-y-4">
          <div>
            <label
              htmlFor="profile-name"
              className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Name
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </label>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
              {user.email}
            </div>
          </div>

          {/* Provider badge */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Sign-in method
            </label>
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
              {badge.label}
            </span>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving || name === user.name}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Change Password (LOCAL only) */}
      {isLocal && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">Change password</h2>
          <form onSubmit={(e) => void changePassword(e)} className="space-y-4">
            <div>
              <label
                htmlFor="current-pw"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Current password
              </label>
              <input
                id="current-pw"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label
                htmlFor="new-pw"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                New password
              </label>
              <input
                id="new-pw"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label
                htmlFor="confirm-pw"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Confirm new password
              </label>
              <input
                id="confirm-pw"
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              >
                {pwSaving ? 'Changing...' : 'Change password'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  )
}
