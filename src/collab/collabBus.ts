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
  | { type: 'setPageSpec'; pageSpec: unknown }

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
let currentUserId: string | null = null
let opsSub: StompSubscription | null = null
let snapshotSub: StompSubscription | null = null
let yjsSub: StompSubscription | null = null
let yjsStateSub: StompSubscription | null = null

const remoteOpListeners = new Set<(msg: RemoteOpMessage) => void>()
const snapshotListeners = new Set<(msg: SnapshotMessage) => void>()
const yjsUpdateListeners = new Set<(msg: YjsUpdateMessage) => void>()
const yjsStateListeners = new Set<(msg: YjsStateMessage) => void>()

// Track our own outbound op ids so we can distinguish echo from remote.
const outstandingClientOpIds = new Set<string>()

// ── Yjs relay message shapes ─────────────────────────────────────────────────

export interface YjsUpdateMessage {
  /** base64-encoded Y.Doc update payload */
  update: string
  /** optional base64-encoded awareness update */
  awareness: string
  /** user id of the sender (used to dedupe our own echo) */
  userId: string
}

export interface YjsStateMessage {
  /** base64-encoded Y.Doc snapshot (possibly empty string when no state yet) */
  state: string
  /** base64 updates since the snapshot, oldest first */
  updates: string[]
}

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
  currentUserId = userId

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

  yjsSub = client.subscribe(`/topic/template/${templateId}/yjs`, (m: IMessage) => {
    try {
      const payload = JSON.parse(m.body) as YjsUpdateMessage
      for (const fn of yjsUpdateListeners) fn(payload)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[collab] malformed yjs update:', err)
    }
  })

  yjsStateSub = client.subscribe(
    `/topic/template/${templateId}/yjs-state/${userId}`,
    (m: IMessage) => {
      try {
        const payload = JSON.parse(m.body) as YjsStateMessage
        for (const fn of yjsStateListeners) fn(payload)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[collab] malformed yjs state:', err)
      }
    },
  )
}

/** Unsubscribe and forget the client. Call from lib/websocket.ts `disconnectFromTemplate`. */
export function unbindCollabBus(): void {
  for (const sub of [opsSub, snapshotSub, yjsSub, yjsStateSub]) {
    if (sub) {
      try { sub.unsubscribe() } catch { /* ignore */ }
    }
  }
  opsSub = null
  snapshotSub = null
  yjsSub = null
  yjsStateSub = null
  currentClient = null
  currentTemplateId = null
  currentUserId = null
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

// ── Yjs relay ────────────────────────────────────────────────────────────────

export function onYjsUpdate(fn: (msg: YjsUpdateMessage) => void): () => void {
  yjsUpdateListeners.add(fn)
  return () => yjsUpdateListeners.delete(fn)
}

export function onYjsState(fn: (msg: YjsStateMessage) => void): () => void {
  yjsStateListeners.add(fn)
  return () => yjsStateListeners.delete(fn)
}

/** Publish a Yjs doc update (base64) + optional awareness update (base64). */
export function sendYjsUpdate(updateBase64: string, awarenessBase64?: string): void {
  if (!currentClient?.connected || !currentTemplateId) return
  currentClient.publish({
    destination: `/app/template/${currentTemplateId}/yjs`,
    body: JSON.stringify({
      update: updateBase64,
      awareness: awarenessBase64 ?? '',
    }),
  })
}

/** Post a compacted full-doc snapshot that replaces the server's buffered state. */
export function sendYjsSnapshot(stateBase64: string): void {
  if (!currentClient?.connected || !currentTemplateId) return
  currentClient.publish({
    destination: `/app/template/${currentTemplateId}/yjs-snapshot`,
    body: JSON.stringify({ state: stateBase64 }),
  })
}

/** Ask the server for the current Yjs snapshot + pending updates. */
export function requestYjsState(): void {
  if (!currentClient?.connected || !currentTemplateId) return
  currentClient.publish({
    destination: `/app/template/${currentTemplateId}/yjs-state`,
    body: '{}',
  })
}

/** Our user id as bound to the current session (null when not connected). */
export function ownUserId(): string | null {
  return currentUserId
}

function generateClientOpId(): string {
  // Browser crypto.randomUUID is available in all modern targets.
  try {
    return crypto.randomUUID()
  } catch {
    return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}
