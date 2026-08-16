import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useConfirm } from './ui/ConfirmDialog'

/**
 * End the session server-side, then locally.
 *
 * <p>Clearing the tab alone left the Redis session live: it kept showing on the
 * staff sessions list with time remaining, and the token stayed usable. Best
 * effort — if the call fails the local sign-out still happens, and the session
 * expires on its own TTL.
 */
async function endSession(accessToken: string | null): Promise<void> {
  if (!accessToken) return
  try {
    await fetch(`${API_BASE}/api/auth/impersonation`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    /* falls back to the TTL */
  }
}

/**
 * Permanent marker that this tab is a staff support session, not the customer's
 * own.
 *
 * <p>Deliberately not dismissible and deliberately loud. Every action taken
 * here is real and lands in the customer's workspace; an operator who forgets
 * which tab they are in is the failure mode this exists to prevent.
 *
 * <p>The countdown ticks down to an absolute deadline rather than from a stored
 * count, and the session is re-checked against the server every 30 seconds so a
 * session ended by someone else stops showing as live here too.
 */
export function ImpersonationBanner() {
  const impersonation = useAuthStore((s) => s.impersonation)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [ending, setEnding] = useState(false)
  const confirm = useConfirm()

  // An absolute deadline, not a counter.
  //
  // This component mounts in two places — AppLayout and the full-screen editor
  // route — so navigating into or out of the editor remounts it. Re-seeding a
  // countdown from `secondsRemaining` on each mount reset the clock to its
  // original value every time, and an operator moving between the editor and
  // the rest of the app could hold a session open indefinitely past its TTL.
  const sessionId = impersonation?.sessionId
  const secondsFromServer = impersonation?.secondsRemaining
  const deadlineRef = useRef<{ sid: string; at: number } | null>(null)

  if (sessionId && secondsFromServer != null
      && deadlineRef.current?.sid !== sessionId) {
    deadlineRef.current = { sid: sessionId, at: Date.now() + secondsFromServer * 1000 }
  }

  useEffect(() => {
    if (!impersonation) {
      deadlineRef.current = null
      setRemaining(null)
      return
    }
    const tick = () => {
      const d = deadlineRef.current
      setRemaining(d == null ? null : Math.max(0, Math.round((d.at - Date.now()) / 1000)))
    }
    tick()
    const handle = window.setInterval(tick, 1000)
    return () => window.clearInterval(handle)
  }, [impersonation])

  // Re-check against the server. The local clock cannot know that another staff
  // member hit End — without this the banner would keep counting down over a
  // session that is already dead, and the operator would only find out on their
  // next request.
  useEffect(() => {
    if (!impersonation) return
    const handle = window.setInterval(() => {
      const token = useAuthStore.getState().accessToken
      if (!token) return
      void fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.impersonation) { logout(); return }
          const secs = data.impersonation.secondsRemaining
          if (typeof secs === 'number' && deadlineRef.current) {
            deadlineRef.current.at = Date.now() + secs * 1000
          }
        })
        .catch(() => { /* transient; the next tick retries */ })
    }, 30_000)
    return () => window.clearInterval(handle)
  }, [impersonation, logout])

  // When the clock runs out the token is already dead server-side; drop the
  // session rather than leave a tab that 401s on everything.
  useEffect(() => {
    if (impersonation && remaining === 0) logout()
  }, [impersonation, remaining, logout])

  if (!impersonation) return null

  const mins = remaining == null ? null : Math.floor(remaining / 60)
  const secs = remaining == null ? null : remaining % 60

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-amber-600 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-100">
        Support session
      </span>
      <span>
        You are signed in as <strong>{user?.email}</strong>. Everything you do here is real
        and happens in their workspace.
      </span>
      <span className="ml-auto flex items-center gap-3">
        {remaining != null && (
          <span className="tabular-nums" title="Time left before this session expires">
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        )}
        <button
          type="button"
          disabled={ending}
          onClick={() => {
            void (async () => {
              if (
                !(await confirm({
                  title: 'End support session?',
                  description:
                    'This tab will be signed out. Any other tabs keep their own session.',
                  confirmLabel: 'End session',
                  variant: 'danger',
                }))
              ) {
                return
              }
              setEnding(true)
              const token = useAuthStore.getState().accessToken
              void endSession(token).finally(() => logout())
            })()
          }}
          className="rounded bg-amber-950 px-2 py-1 text-xs font-semibold text-amber-100 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {ending ? 'Ending…' : 'End session'}
        </button>
      </span>
    </div>
  )
}
