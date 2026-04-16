import { Client } from '@stomp/stompjs'
import type { IMessage, StompSubscription } from '@stomp/stompjs'
import { useAuthStore } from '../stores/authStore'
import { usePresenceStore } from '../stores/presenceStore'
import type { PresenceUser } from '../stores/presenceStore'
import { API_BASE } from './api'
import { bindCollabBus, requestSnapshot, unbindCollabBus } from '../collab/collabBus'

// ── Singleton state ──

let stompClient: Client | null = null
let presenceSub: StompSubscription | null = null
let viewportSub: StompSubscription | null = null
let selectionSub: StompSubscription | null = null
let activeTemplateId: string | null = null

// ── Helpers ──

function wsUrl(): string {
  // If API_BASE is set (e.g. production with separate backend host), use it.
  // Otherwise fall back to same-origin (local dev with Vite proxy).
  if (API_BASE) {
    try {
      const u = new URL(API_BASE)
      const proto = u.protocol === 'https:' ? 'wss' : 'ws'
      return `${proto}://${u.host}/ws`
    } catch {
      // fall through to same-origin
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws`
}

// ── Public API ──

export function connectToTemplate(templateId: string): void {
  // Already connected to this template
  if (stompClient?.connected && activeTemplateId === templateId) return

  // Disconnect any previous session first
  if (stompClient) {
    void disconnectFromTemplate()
  }

  const auth = useAuthStore.getState()
  const token = auth.accessToken
  const user = auth.user

  if (!token || !user) return

  activeTemplateId = templateId

  const client = new Client({
    brokerURL: wsUrl(),
    connectHeaders: {
      Authorization: `Bearer ${token}`,
    },
    reconnectDelay: 1000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,

    onConnect: () => {
      // Send join message
      client.publish({
        destination: `/app/template/${templateId}/join`,
        body: JSON.stringify({
          userId: user.id,
          name: user.name,
          email: user.email,
        }),
      })

      // Subscribe to presence updates.
      // Backend sends PresenceMessage { users: [...] }; tolerate either shape
      // (bare array or envelope) to keep this resilient to wire-format churn.
      presenceSub = client.subscribe(
        `/topic/template/${templateId}/presence`,
        (message: IMessage) => {
          try {
            const parsed = JSON.parse(message.body) as PresenceUser[] | { users?: PresenceUser[] }
            const users: PresenceUser[] = Array.isArray(parsed)
              ? parsed
              : Array.isArray(parsed?.users)
                ? parsed.users!
                : []
            usePresenceStore.getState().setUsers(users)
          } catch (err) {
            console.error('[websocket] Malformed presence message:', err)
          }
        },
      )

      // Subscribe to viewport updates
      viewportSub = client.subscribe(
        `/topic/template/${templateId}/viewport`,
        (message: IMessage) => {
          try {
            const data = JSON.parse(message.body) as {
              userId: string
              zoom: number
              scrollX: number
              scrollY: number
            }
            usePresenceStore.getState().updateViewport(data.userId, {
              zoom: data.zoom,
              scrollX: data.scrollX,
              scrollY: data.scrollY,
            })
          } catch (err) {
            console.error('[websocket] Malformed viewport message:', err)
          }
        },
      )

      // Subscribe to remote selection updates
      selectionSub = client.subscribe(
        `/topic/template/${templateId}/selection`,
        (message: IMessage) => {
          try {
            const data = JSON.parse(message.body) as {
              userId: string
              selectedIds?: string[]
            }
            const ids = Array.isArray(data.selectedIds) ? data.selectedIds : []
            usePresenceStore.getState().updateSelection(data.userId, ids)
          } catch (err) {
            console.error('[websocket] Malformed selection message:', err)
          }
        },
      )

      // Bind collaborative-editor topics (structural ops + snapshot reply) and
      // ask the server for the current hot layout now that we're connected.
      bindCollabBus(client, templateId, user.id)
      requestSnapshot()
    },

    onStompError: (frame) => {
      console.error('[websocket] STOMP error:', frame.headers['message'])
    },

    onWebSocketError: (event) => {
      console.error('[websocket] WebSocket error:', event)
    },
  })

  // Exponential backoff: @stomp/stompjs handles reconnection internally via
  // reconnectDelay. We increase the delay on successive failures.
  let reconnectAttempts = 0
  const baseDelay = 1000
  const maxDelay = 30000

  const originalOnWebSocketClose = client.onWebSocketClose
  client.onWebSocketClose = (event) => {
    if (originalOnWebSocketClose) {
      originalOnWebSocketClose.call(client, event)
    }
    reconnectAttempts++
    client.reconnectDelay = Math.min(
      baseDelay * Math.pow(2, reconnectAttempts),
      maxDelay,
    )
  }

  const originalOnConnect = client.onConnect
  client.onConnect = (frame) => {
    // Reset backoff on successful connection
    reconnectAttempts = 0
    client.reconnectDelay = baseDelay
    if (originalOnConnect) {
      originalOnConnect.call(client, frame)
    }
  }

  stompClient = client
  client.activate()
}

export function disconnectFromTemplate(): void {
  if (!stompClient) return

  const templateId = activeTemplateId
  const auth = useAuthStore.getState()
  const user = auth.user

  // Send leave message if still connected
  if (stompClient.connected && templateId && user) {
    try {
      stompClient.publish({
        destination: `/app/template/${templateId}/leave`,
        body: JSON.stringify({ userId: user.id }),
      })
    } catch {
      // Best effort — may fail if connection already closing
    }
  }

  // Unsubscribe
  if (presenceSub) {
    try { presenceSub.unsubscribe() } catch { /* ignore */ }
    presenceSub = null
  }
  if (viewportSub) {
    try { viewportSub.unsubscribe() } catch { /* ignore */ }
    viewportSub = null
  }
  if (selectionSub) {
    try { selectionSub.unsubscribe() } catch { /* ignore */ }
    selectionSub = null
  }
  unbindCollabBus()

  // Deactivate
  void stompClient.deactivate()
  stompClient = null
  activeTemplateId = null

  // Clear presence state
  usePresenceStore.getState().setUsers([])
  usePresenceStore.getState().setFollowing(null)
}

export function sendViewportUpdate(
  templateId: string,
  zoom: number,
  scrollX: number,
  scrollY: number,
): void {
  if (!stompClient?.connected) return

  const user = useAuthStore.getState().user
  if (!user) return

  stompClient.publish({
    destination: `/app/template/${templateId}/viewport`,
    body: JSON.stringify({
      userId: user.id,
      zoom,
      scrollX,
      scrollY,
    }),
  })
}

/**
 * Broadcast the current user's selected element ids. Server re-broadcasts to
 * every other subscriber for colored selection outlines.
 */
export function sendSelectionUpdate(templateId: string, selectedIds: string[]): void {
  if (!stompClient?.connected) return
  const user = useAuthStore.getState().user
  if (!user) return
  stompClient.publish({
    destination: `/app/template/${templateId}/selection`,
    body: JSON.stringify({
      userId: user.id,
      selectedIds,
    }),
  })
}
