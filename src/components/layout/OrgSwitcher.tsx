import { useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuthStore, type OrgDto, type MeOrgEntry } from '../../stores/authStore'
import { authFetch } from '../../lib/api'
import { usePermissions } from '../../hooks/usePermissions'
import { useEntitlements } from '../../hooks/useEntitlements'

export function OrgSwitcher() {
  const { canManageOrg } = usePermissions()
  const org = useAuthStore((s) => s.org)
  const orgs = useAuthStore((s) => s.orgs)
  const setOrg = useAuthStore((s) => s.setOrg)
  const { entitlements } = useEntitlements()
  // The workspace allowance is per-user, not per-workspace, so count the ones
  // this user administers — mirroring PlanGate.requireWorkspaceHeadroom.
  // maxWorkspaces is 0 for paid and grandfathered workspaces, i.e. no cap.
  const ownedCount = orgs.filter((o) => o.role === 'ADMIN').length
  const anyOwnedPaid = orgs.some((o) => o.role === 'ADMIN' && o.org.plan !== 'FREE')
  const workspaceCap = entitlements?.maxWorkspaces ?? 0
  const atWorkspaceLimit = workspaceCap > 0 && !anyOwnedPaid && ownedCount >= workspaceCap

  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowCreate(false)
        setNewName('')
        setError(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (showCreate) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [showCreate])

  function handleSelect(selected: OrgDto) {
    setOrg(selected)
    setOpen(false)
    setShowCreate(false)
  }

  function openCreate() {
    setShowCreate(true)
    setNewName('')
    setError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      const res = await authFetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to create workspace' }))
        throw new Error(err.message || 'Failed to create workspace')
      }
      const newOrg: OrgDto = await res.json()

      // Add to store orgs list and switch to it
      const newEntry: MeOrgEntry = { org: newOrg, role: 'ADMIN' }
      useAuthStore.setState((s) => ({ orgs: [...s.orgs, newEntry] }))
      setOrg(newOrg)
      setOpen(false)
      setShowCreate(false)
      setNewName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); setShowCreate(false); setError(null) }}
        className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        <span className="max-w-[140px] truncate">{org?.name ?? 'No workspace'}</span>
        <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          {/* Workspace list */}
          {orgs.map((entry) => (
            <button
              key={entry.org.id}
              onClick={() => handleSelect(entry.org)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                entry.org.id === org?.id
                  ? 'text-violet-600 dark:text-violet-400'
                  : 'text-zinc-700 dark:text-zinc-200'
              }`}
            >
              {entry.org.logoUrl ? (
                <img src={entry.org.logoUrl} alt="" className="h-5 w-5 rounded object-cover" />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-violet-100 text-xs font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                  {entry.org.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="flex-1 truncate">{entry.org.name}</span>
              {entry.org.id === org?.id && (
                <svg className="ml-auto h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}

          {orgs.length > 0 && canManageOrg && <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />}

          {/* Create workspace — only for admins of the current org */}
          {canManageOrg && showCreate && (
            <form onSubmit={(e) => void handleCreate(e)} className="px-3 py-2">
              <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">New workspace name</p>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
              {error && (
                <p className="mt-1 text-xs text-red-500">{error}</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="flex-1 rounded-md bg-violet-600 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setError(null) }}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {canManageOrg && !showCreate && !atWorkspaceLimit && (
            <button
              onClick={openCreate}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create new workspace
            </button>
          )}

          {canManageOrg && atWorkspaceLimit && (
            <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-700">
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                The free plan includes {workspaceCap} workspace.
              </p>
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/settings?tab=billing') }}
                className="mt-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
              >
                Upgrade for more →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
