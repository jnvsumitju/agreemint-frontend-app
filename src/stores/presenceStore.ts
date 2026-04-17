import { create } from 'zustand'

export interface PresenceUser {
  userId: string
  name: string
  email: string
  color: string
  connectedAt: string
}

export interface ViewportState {
  zoom: number
  scrollX: number
  scrollY: number
  /** Page the user is currently viewing. Used by follow mode to jump pages. */
  activePageIndex?: number
}

export interface PresenceState {
  users: PresenceUser[]
  viewports: Record<string, ViewportState>
  /** userId → element ids that user currently has selected on the canvas. */
  selections: Record<string, string[]>
  followingUserId: string | null

  setUsers: (users: PresenceUser[]) => void
  updateViewport: (userId: string, viewport: ViewportState) => void
  updateSelection: (userId: string, selectedIds: string[]) => void
  setFollowing: (userId: string | null) => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  users: [],
  viewports: {},
  selections: {},
  followingUserId: null,

  setUsers: (users) =>
    set((s) => {
      // Drop selections for users who are no longer present.
      const ids = new Set(users.map((u) => u.userId))
      const pruned: Record<string, string[]> = {}
      for (const [uid, sel] of Object.entries(s.selections)) {
        if (ids.has(uid)) pruned[uid] = sel
      }
      return { users, selections: pruned }
    }),

  updateViewport: (userId, viewport) =>
    set((s) => ({
      viewports: { ...s.viewports, [userId]: viewport },
    })),

  updateSelection: (userId, selectedIds) =>
    set((s) => ({
      selections: { ...s.selections, [userId]: selectedIds },
    })),

  setFollowing: (userId) => set({ followingUserId: userId }),
}))
