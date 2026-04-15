import { Client } from '@stomp/stompjs'
import type { IMessage, StompSubscription } from '@stomp/stompjs'
import { useAuthStore } from '../stores/authStore'
import { usePresenceStore } from '../stores/presenceStore'
import type { PresenceUser } from '../stores/presenceStore'

// ── Singleton state ──

let stompClient: Client | null = null
let presenceSub: StompSubscription | null = null
let viewportSub: StompSubscription | null = null
let activeTemplateId: string | null = null

// ── Helpers ──

function wsUrl(): string {
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

      // Subscribe to presence updates
      presenceSub = client.subscribe(
        `/topic/template/${templateId}/presence`,
        (message: IMessage) => {
          try {
            const users = JSON.parse(message.body) as PresenceUser[]
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
