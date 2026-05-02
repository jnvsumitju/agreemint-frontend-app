import { create } from 'zustand'

/**
 * Live-edit websocket status, surfaced to the toolbar's connection
 * indicator. {@code idle} means we're not trying to connect (no template
 * mounted, or {@link disconnectFromTemplate} was called); the indicator
 * hides itself in that state. The other states map to the wifi-icon
 * variants the user sees: connecting/reconnecting → pulsing amber,
 * connected → solid green, disconnected → struck-through grey.
 */
export type CollabConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

interface CollabConnectionState {
  status: CollabConnectionStatus
  setStatus: (s: CollabConnectionStatus) => void
}

export const useCollabConnectionStore = create<CollabConnectionState>((set) => ({
  status: 'idle',
  setStatus: (s) => set({ status: s }),
}))
