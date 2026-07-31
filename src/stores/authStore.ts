import { create } from 'zustand'
import { API_BASE } from '../lib/api'

// ── DTOs ──

export interface UserDto {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  provider: string
  createdAt: string
}

export interface OrgDto {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  plan: string
}

/** Mirrors AuthService.Impersonation. Null unless the session is live. */
export interface ImpersonationDto {
  sessionId: string
  operatorId: string
  operatorEmail: string
  /** Workspace the session was opened against — what the operator picked. */
  orgId: string | null
  /** From the Redis TTL server-side, so it goes null once revoked. */
  secondsRemaining: number | null
}

export interface MeOrgEntry {
  org: OrgDto
  role: string
}

// ── Store ──

interface AuthState {
  user: UserDto | null
  org: OrgDto | null
  orgs: MeOrgEntry[]
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  /** Set when this tab is running a staff impersonation session. */
  impersonation: ImpersonationDto | null

  /** Initialize from localStorage tokens, fetch /me if valid. Idempotent — safe to call multiple times. */
  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, name: string, password: string, inviteToken?: string) => Promise<{ requiresVerification: boolean }>
  logout: () => void
  refreshTokens: () => Promise<boolean>
  setOrg: (org: OrgDto) => void
  /**
   * Adopt a staff-minted impersonation token for this tab only.
   * Resolves false when the token is rejected or its session is already dead.
   */
  adoptImpersonation: (accessToken: string) => Promise<boolean>
  /** Update user fields after profile edit. */
  setUser: (patch: Partial<UserDto>) => void
}

const TOKEN_KEY = 'agreemint-access-token'
const REFRESH_KEY = 'agreemint-refresh-token'
const ORG_KEY = 'agreemint-org-id'
/**
 * Impersonation tokens live in sessionStorage, never localStorage.
 *
 * <p>sessionStorage is per-tab and dies with the tab, which is the right
 * lifetime for a support session and keeps the credential out of the operator's
 * other windows. Writing it to the normal token key would be worse than
 * untidy: init() would find an access token with no refresh token beside it and
 * log itself out, and a real login in another tab would silently clobber the
 * session — or be clobbered by it.
 */
const IMPERSONATION_KEY = 'agreemint-impersonation-token'

// Singleton promise — prevents React StrictMode's double-effect from
// calling init() twice and racing on the same refresh token.
let _initPromise: Promise<void> | null = null

/**
 * Set synchronously by the handoff route the instant it sees a token, before
 * any await.
 *
 * <p>App's root effect calls init() on the same mount as /impersonate renders,
 * and init() reads sessionStorage synchronously while adoptImpersonation only
 * writes it *after* its /me round trip. So init() saw an empty key, took the
 * ordinary localStorage path, and a round trip later overwrote the adopted
 * session with whoever last logged into this browser — leaving an unbannered
 * tab signed in as the operator themselves.
 */
let _handoffInFlight = false

/**
 * Sticky for the life of the tab once a support session has run in it.
 *
 * <p>logout() branches on it rather than on the live store value, which is
 * nulled by the first of two concurrent calls.
 */
let _wasImpersonating = false

/**
 * Drop every trace of a support session before establishing an ordinary one.
 *
 * <p>Without this, signing in normally in a tab that still held an impersonation
 * token left the token in sessionStorage — so init() re-adopted it over the real
 * login on the next reload — and left `impersonation` set, so the banner
 * mislabelled the operator's own account and its countdown eventually signed
 * them out of it.
 */
function clearImpersonationArtifacts(): void {
  sessionStorage.removeItem(IMPERSONATION_KEY)
  _wasImpersonating = false
  _handoffInFlight = false
}

export function claimImpersonationHandoff(): void {
  _handoffInFlight = true
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  org: null,
  orgs: [],
  accessToken: sessionStorage.getItem(IMPERSONATION_KEY) ?? localStorage.getItem(TOKEN_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  isAuthenticated: false,
  isLoading: true,
  impersonation: null,

  init: () => {
    if (!_initPromise) {
      _initPromise = (async () => {
        // An impersonation session bootstraps from its access token alone.
        // There is deliberately no refresh token for one — a support session
        // that could renew itself would outlive the TTL the operator chose.
        // A handoff is mid-flight in this tab; it owns the store.
        if (_handoffInFlight) {
          set({ isLoading: false })
          return
        }

        const impersonationToken = sessionStorage.getItem(IMPERSONATION_KEY)
        if (impersonationToken) {
          const ok = await get().adoptImpersonation(impersonationToken)
          if (ok) {
            set({ isLoading: false })
            return
          }
          // Token dead (expired or revoked). Fall through to the ordinary path.
          // isLoading deliberately stays true here: flipping it before that path
          // resolves lets ProtectedRoute redirect to /login mid-flight, stranding
          // a session that is about to authenticate successfully.
        }

        const { refreshToken } = get()
        if (!refreshToken) {
          set({ isLoading: false })
          return
        }

        // Try to refresh and fetch user info
        const ok = await get().refreshTokens()
        if (!ok) {
          set({ isLoading: false })
          return
        }

        try {
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${get().accessToken}` },
          })
          if (!res.ok) throw new Error('Failed to fetch user')
          const data = await res.json()
          const savedOrgId = localStorage.getItem(ORG_KEY)
          const orgs: MeOrgEntry[] = data.orgs ?? []
          const org = orgs.find((o: MeOrgEntry) => o.org.id === savedOrgId)?.org ?? orgs[0]?.org ?? null

          set({
            user: data.user,
            org,
            orgs,
            isAuthenticated: true,
            isLoading: false,
            impersonation: null,
          })
        } catch {
          get().logout()
          set({ isLoading: false })
        }
      })()
    }
    return _initPromise
  },

  adoptImpersonation: async (accessToken) => {
    _wasImpersonating = true
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) throw new Error('rejected')
      const data = await res.json()

      // The server is the authority on whether this is really an impersonation
      // session. A token that does not come back with one is not treated as a
      // support session, so the banner can never be missing while the session
      // is live.
      if (!data.impersonation) throw new Error('not an impersonation token')

      sessionStorage.setItem(IMPERSONATION_KEY, accessToken)
      const orgs: MeOrgEntry[] = data.orgs ?? []
      // The workspace the operator actually chose, as recorded server-side.
      // Falling back to orgs[0] here silently put the session in the target's
      // first workspace instead: the operator would pick one tenant, be shown
      // another's templates and documents, and edit them believing otherwise —
      // while the audit trail named the workspace they picked.
      // No orgs[0] fallback: landing in a workspace the operator did not choose
      // is the exact failure this scoping is here to prevent, and it is silent.
      const scopedOrg = orgs.find((o) => o.org.id === data.impersonation.orgId)?.org
      if (!scopedOrg) throw new Error('session workspace not available')
      set({
        user: data.user,
        org: scopedOrg,
        orgs,
        accessToken,
        refreshToken: null,
        isAuthenticated: true,
        impersonation: data.impersonation,
      })
      return true
    } catch {
      sessionStorage.removeItem(IMPERSONATION_KEY)
      // Release the claim: with it latched, init() would stand down forever and
      // this tab could never sign anyone in again.
      _handoffInFlight = false
      return false
    }
  },

  login: async (email, password) => {
    clearImpersonationArtifacts()
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Login failed' }))
      throw new Error(err.message || 'Login failed')
    }
    const data = await res.json()
    persistTokens(data.accessToken, data.refreshToken)
    if (data.org?.id) localStorage.setItem(ORG_KEY, data.org.id)
    const orgs: MeOrgEntry[] = data.org
      ? [{ org: data.org, role: data.role ?? 'ADMIN' }]
      : []
    set({
      user: data.user,
      org: data.org,
      orgs,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      isAuthenticated: true,
      // A real login must not inherit a stale support session: the banner
      // would mislabel the operator's own account, and its expiry would sign
      // them out of it.
      impersonation: null,
    })
  },

  register: async (email, name, password, inviteToken?) => {
    clearImpersonationArtifacts()
    const body: Record<string, string> = { email, name, password }
    if (inviteToken) body.inviteToken = inviteToken
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Registration failed' }))
      throw new Error(err.message || 'Registration failed')
    }
    const data = await res.json()

    // Verification required — don't log in, frontend should redirect to "check your email"
    if (data.requiresVerification) {
      return { requiresVerification: true }
    }

    persistTokens(data.accessToken, data.refreshToken)
    if (data.org?.id) localStorage.setItem(ORG_KEY, data.org.id)
    const orgs: MeOrgEntry[] = data.org
      ? [{ org: data.org, role: data.role ?? 'ADMIN' }]
      : []
    set({
      user: data.user,
      org: data.org,
      orgs,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      isAuthenticated: true,
      // A real login must not inherit a stale support session: the banner
      // would mislabel the operator's own account, and its expiry would sign
      // them out of it.
      impersonation: null,
    })
    return { requiresVerification: false }
  },

  logout: () => {
    _initPromise = null   // allow init() to re-run after logout
    _handoffInFlight = false

    // An impersonation tab must only clear its own sessionStorage. Clearing
    // localStorage too would sign the browser's real owner out of their own
    // account in every other tab — a support session ending should not log the
    // customer (or the operator) out of theirs.
    //
    // `_wasImpersonating` rather than the live store value: two concurrent 401s
    // both call logout(), and the second would find impersonation already
    // nulled by the first and wipe localStorage after all.
    if (get().impersonation) _wasImpersonating = true
    if (_wasImpersonating) {
      sessionStorage.removeItem(IMPERSONATION_KEY)
      set({
        user: null,
        org: null,
        orgs: [],
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        impersonation: null,
      })
      return
    }

    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(ORG_KEY)
    sessionStorage.removeItem(IMPERSONATION_KEY)
    set({
      user: null,
      org: null,
      orgs: [],
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      impersonation: null,
    })
  },

  refreshTokens: async () => {
    const rt = get().refreshToken
    if (!rt) return false
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      })
      if (!res.ok) {
        get().logout()
        return false
      }
      const data = await res.json()
      persistTokens(data.accessToken, data.refreshToken)
      set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      })
      return true
    } catch {
      get().logout()
      return false
    }
  },

  setOrg: (org) => {
    localStorage.setItem(ORG_KEY, org.id)
    set({ org })
  },

  setUser: (patch) => {
    const prev = get().user
    if (!prev) return
    set({ user: { ...prev, ...patch } })
  },
}))

function persistTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}
