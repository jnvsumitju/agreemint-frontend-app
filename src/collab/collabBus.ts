// Collab transport — wraps the existing STOMP client (lib/websocket.ts) with
// send/receive helpers for structural ops and snapshot requests.
//
// The client lifecycle is owned by lib/websocket.ts (connectToTemplate /
// disconnectFromTemplate). This module just issues publishes and routes
// inbound op/snapshot messages to registered listeners.
//
// Only Phase-1 structural ops are handled here. Phase 2 adds Yjs relay.

import type { Client, IMessage, StompSubscription } from '@stomp/stompjs'

// ── Op type mirrors backend CollabOp records ──────────────────────────────────

export type CollabOp =
  | { type: 'addElement'; pageIndex: number; element: unknown }
  | { type: 'deleteElements'; pageIndex: number; elementIds: string[] }
  | { type: 'updateElement'; pageIndex: number; elementId: string; patch: Record<string, unknown> }
  | {
      type: 'bulkUpdateElements'
      pageIndex: number
      updates: Array<{ elementId: string; patch: Record<string, unknown> }>
    }
  | { type: 'addPage'; index: number; page: unknown }
  | { type: 'deletePage'; index: number }
  | { type: 'reorderPages'; from: number; to: number }
  | { type: 'updatePage'; pageIndex: number; patch: Record<string, unknown> }
  | { type: 'setGlobalVariables'; variables: unknown }
  | { type: 'setPageVariables'; pageIndex: number; variables: unknown }

export interface RemoteOpMessage {
  serverSeq: number
  clientOpId: string
  userId: string
  op: CollabOp
}

export interface SnapshotMessage {
  layout: unknown
  seq: number
}

// ── Module state ─────────────────────────────────────────────────────────────

let currentClient: Client | null = null
let currentTemplateId: string | null = null
let opsSub: StompSubscription | null = null
let snapshotSub: StompSubscription | null = null

const remoteOpListeners = new Set<(msg: RemoteOpMessage) => void>()
const snapshotListeners = new Set<(msg: SnapshotMessage) => void>()

// Track our own outbound op ids so we can distinguish echo from remote.
const outstandingClientOpIds = new Set<string>()

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Bind the bus to an active STOMP client and subscribe to this template's
 * collaborative topics. Idempotent: re-binding to the same client+template is a no-op.
 * Call from lib/websocket.ts `onConnect`.
 */
export function bindCollabBus(client: Client, templateId: string, userId: string): void {
  if (currentClient === client && currentTemplateId === templateId) return
  unbindCollabBus()

  currentClient = client
  currentTemplateId = templateId

  opsSub = client.subscribe(`/topic/template/${templateId}/ops`, (m: IMessage) => {
    try {
      const payload = JSON.parse(m.body) as RemoteOpMessage
      for (const fn of remoteOpListeners) fn(payload)
      outstandingClientOpIds.delete(payload.clientOpId)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[collab] malformed op message:', err)
    }
  })

  snapshotSub = client.subscribe(
    `/topic/template/${templateId}/snapshot/${userId}`,
    (m: IMessage) => {
      try {
        const payload = JSON.parse(m.body) as SnapshotMessage
        for (const fn of snapshotListeners) fn(payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[collab] malformed snapshot message:', err)
      }
    },
  )
}

/** Unsubscribe and forget the client. Call from lib/websocket.ts `disconnectFromTemplate`. */
export function unbindCollabBus(): void {
  if (opsSub) {
    try { opsSub.unsubscribe() } catch { /* ignore */ }
    opsSub = null
  }
  if (snapshotSub) {
    try { snapshotSub.unsubscribe() } catch { /* ignore */ }
    snapshotSub = null
  }
  currentClient = null
  currentTemplateId = null
  outstandingClientOpIds.clear()
}

export function onRemoteOp(fn: (msg: RemoteOpMessage) => void): () => void {
  remoteOpListeners.add(fn)
  return () => remoteOpListeners.delete(fn)
}

export function onSnapshot(fn: (msg: SnapshotMessage) => void): () => void {
  snapshotListeners.add(fn)
  return () => snapshotListeners.delete(fn)
}

/** Send a structural op. Returns the generated clientOpId. Safe to call before connect — drops silently. */
export function sendOp(op: CollabOp): string | null {
  if (!currentClient?.connected || !currentTemplateId) return null
  const clientOpId = generateClientOpId()
  outstandingClientOpIds.add(clientOpId)
  currentClient.publish({
    destination: `/app/template/${currentTemplateId}/op`,
    body: JSON.stringify({ clientOpId, op }),
  })
  return clientOpId
}

/** Ask the server for the current hot layout. Reply arrives via snapshot listeners. */
export function requestSnapshot(): void {
  if (!currentClient?.connected || !currentTemplateId) return
  currentClient.publish({
    destination: `/app/template/${currentTemplateId}/snapshot`,
    body: '{}',
  })
}

/** Was the given clientOpId originated by this client (i.e. still outstanding)? */
export function isOwnOp(clientOpId: string): boolean {
  return outstandingClientOpIds.has(clientOpId)
}

function generateClientOpId(): string {
  // Browser crypto.randomUUID is available in all modern targets.
  try {
    return crypto.randomUUID()
  } catch {
    return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}
