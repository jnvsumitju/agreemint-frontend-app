import { useState, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { authFetch } from '../lib/api'

export function Profile() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [name, setName] = useState(user?.name ?? '')
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl ?? '')
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

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      setAvatarPreview(base64)
    }
    reader.readAsDataURL(file)
  }

  async function saveProfile() {
    setSaving(true)
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatarUrl: avatarPreview || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Update failed' }))
        throw new Error(err.message || 'Update failed')
      }
      setUser({ name, avatarUrl: avatarPreview || null })
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
              className="mt-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Change avatar
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
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
              disabled={saving || name === user.name && avatarPreview === (user.avatarUrl ?? '')}
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

      {/* Connected Accounts */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">Connected accounts</h2>
        <div className="space-y-3">
          {/* Google */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Google</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {user.provider === 'GOOGLE' ? 'Connected' : 'Not connected'}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {user.provider === 'GOOGLE' ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* GitHub */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-900 dark:text-zinc-100">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">GitHub</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {user.provider === 'GITHUB' ? 'Connected' : 'Not connected'}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {user.provider === 'GITHUB' ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Account linking will be available soon.
        </p>
      </div>
    </div>
  )
}
