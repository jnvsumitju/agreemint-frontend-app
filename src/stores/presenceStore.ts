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
}

export interface PresenceState {
  users: PresenceUser[]
  viewports: Record<string, ViewportState>
  followingUserId: string | null

  setUsers: (users: PresenceUser[]) => void
  updateViewport: (userId: string, viewport: ViewportState) => void
  setFollowing: (userId: string | null) => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  users: [],
  viewports: {},
  followingUserId: null,

  setUsers: (users) => set({ users }),

  updateViewport: (userId, viewport) =>
    set((s) => ({
      viewports: { ...s.viewports, [userId]: viewport },
    })),

  setFollowing: (userId) => set({ followingUserId: userId }),
}))
