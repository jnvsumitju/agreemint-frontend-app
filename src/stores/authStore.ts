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

  /** Initialize from localStorage tokens, fetch /me if valid. Idempotent — safe to call multiple times. */
  init: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, name: string, password: string, inviteToken?: string) => Promise<void>
  logout: () => void
  refreshTokens: () => Promise<boolean>
  setOrg: (org: OrgDto) => void
  /** Update user fields after profile edit. */
  setUser: (patch: Partial<UserDto>) => void
}

const TOKEN_KEY = 'agreemint-access-token'
const REFRESH_KEY = 'agreemint-refresh-token'
const ORG_KEY = 'agreemint-org-id'

// Singleton promise — prevents React StrictMode's double-effect from
// calling init() twice and racing on the same refresh token.
let _initPromise: Promise<void> | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  org: null,
  orgs: [],
  accessToken: localStorage.getItem(TOKEN_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  isAuthenticated: false,
  isLoading: true,

  init: () => {
    if (!_initPromise) {
      _initPromise = (async () => {
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
          })
        } catch {
          get().logout()
          set({ isLoading: false })
        }
      })()
    }
    return _initPromise
  },

  login: async (email, password) => {
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
    })
  },

  register: async (email, name, password, inviteToken?) => {
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
    })
  },

  logout: () => {
    _initPromise = null   // allow init() to re-run after logout
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(ORG_KEY)
    set({
      user: null,
      org: null,
      orgs: [],
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
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
