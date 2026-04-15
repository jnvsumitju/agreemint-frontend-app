import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { authFetch } from '../../lib/api'

interface OrgMember {
  id: string
  userId: string
  orgId: string
  userName: string
  userEmail: string
  userAvatar: string | null
  role: string
  createdAt: string
}

const ROLES = ['ADMIN', 'DESIGNER', 'REVIEWER', 'VIEWER'] as const

function roleBadgeColor(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
    case 'DESIGNER':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    case 'REVIEWER':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    case 'VIEWER':
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
    default:
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
  }
}

function initials(name: string) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'
}

export function MembersTab() {
  const org = useAuthStore((s) => s.org)
  const orgs = useAuthStore((s) => s.orgs)
  const user = useAuthStore((s) => s.user)

  const entry = orgs.find((e) => e.org.id === org?.id)
  const isAdmin = entry?.role === 'ADMIN'

  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('VIEWER')
  const [inviting, setInviting] = useState(false)

  // Remove confirmation
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchMembers = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const res = await authFetch(`/api/orgs/${org.id}/members`)
      if (!res.ok) throw new Error('Failed to load members')
      const data: OrgMember[] = await res.json()
      setMembers(data)
    } catch {
      showToast('error', 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [org])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  async function changeRole(memberId: string, newRole: string) {
    if (!org) return
    try {
      const res = await authFetch(`/api/orgs/${org.id}/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to change role' }))
        throw new Error(err.message || 'Failed to change role')
      }
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)))
      showToast('success', 'Role updated')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to change role')
    }
  }

  async function removeMember(memberId: string) {
    if (!org) return
    try {
      const res = await authFetch(`/api/orgs/${org.id}/members/${memberId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to remove member' }))
        throw new Error(err.message || 'Failed to remove member')
      }
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
      setConfirmRemoveId(null)
      showToast('success', 'Member removed')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  async function inviteMember(e: React.FormEvent) {
    e.preventDefault()
    if (!org || !inviteEmail.trim()) return
    setInviting(true)
    try {
      const res = await authFetch(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to invite' }))
        throw new Error(err.message || 'Failed to invite')
      }
      setInviteEmail('')
      setInviteRole('VIEWER')
      showToast('success', `Invitation sent to ${inviteEmail.trim()}`)
      void fetchMembers()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  if (!org) return null

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
          Only admins can manage members. You have read-only access.
        </div>
      )}

      {/* Members list */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Members</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          </div>
        ) : members.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No members found.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {members.map((member) => (
              <div key={member.id} className="flex items-center gap-4 px-6 py-3">
                {/* Avatar */}
                {member.userAvatar ? (
                  <img
                    src={member.userAvatar}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                    {initials(member.userName || member.userEmail || '?')}
                  </div>
                )}

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {member.userName || member.userEmail}
                    {member.userId === user?.id && (
                      <span className="ml-1.5 text-xs text-zinc-400 dark:text-zinc-500">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{member.userEmail}</p>
                </div>

                {/* Role */}
                {isAdmin && member.userId !== user?.id ? (
                  <select
                    value={member.role}
                    onChange={(e) => void changeRole(member.id, e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeColor(member.role)}`}>
                    {member.role}
                  </span>
                )}

                {/* Remove */}
                {isAdmin && member.userId !== user?.id && (
                  <>
                    {confirmRemoveId === member.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void removeMember(member.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(member.id)}
                        className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        title="Remove member"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite form */}
      {isAdmin && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">Invite a member</h2>
          <form onSubmit={(e) => void inviteMember(e)} className="flex items-end gap-3">
            <div className="flex-1">
              <label
                htmlFor="invite-email"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email address
              </label>
              <input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div className="w-36">
              <label
                htmlFor="invite-role"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
            >
              {inviting ? 'Inviting...' : 'Invite'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
