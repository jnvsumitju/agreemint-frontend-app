// Y.Doc lifecycle + STOMP transport.
//
// One Y.Doc per active templateId (we only ever edit one template at a time,
// but keying by template makes the ownership explicit and makes remounts safe).
// Every text-bearing element gets a `Y.XmlFragment` keyed by element id.
//
// Transport: this module is a thin bridge to collabBus — it encodes doc updates
// as base64 and publishes them, and decodes inbound updates before applying.
// Snapshot compaction: every COMPACT_INTERVAL_MS we post `Y.encodeStateAsUpdate`
// so server can GC buffered updates.

import * as Y from 'yjs'
import {
  onYjsState,
  onYjsUpdate,
  ownUserId,
  requestYjsState,
  sendYjsSnapshot,
  sendYjsUpdate,
} from './collabBus'

const COMPACT_INTERVAL_MS = 60_000

interface ProviderState {
  templateId: string
  doc: Y.Doc
  /** Dispose listeners and timers. */
  teardown: () => void
}

let active: ProviderState | null = null

/**
 * Return the Y.Doc for the given templateId, creating it on first call.
 * Safe to call before `connectYDoc` — text editors can bind to fragments
 * immediately; updates just won't be relayed until the transport is up.
 */
export function getYDoc(templateId: string): Y.Doc {
  if (active?.templateId === templateId) return active.doc
  // Different template — callers who actually want a provider should call
  // disconnectYDoc first. Return a fresh doc here as a read-only fallback.
  return new Y.Doc()
}

/** Convenience accessor for an element's rich-text XmlFragment. */
export function getYFragment(templateId: string, elementId: string): Y.XmlFragment {
  return getYDoc(templateId).getXmlFragment(fragmentKey(elementId))
}

/** Deterministic key inside the Y.Doc for a given element's rich content. */
export function fragmentKey(elementId: string): string {
  return `el:${elementId}`
}

/**
 * Empty out the Yjs XmlFragment that backs an element's rich text. Called
 * when the element is deleted so a peer who's still mid-edit on it can't
 * keep typing into an orphan fragment, and so the doc doesn't accumulate
 * dead content. The fragment object itself stays in the doc (Yjs has no
 * "drop top-level type" API), but its contents are removed in a single
 * Yjs transaction that propagates to every other client. Idempotent —
 * deleting from an empty fragment is a no-op.
 */
export function clearYFragmentForElement(elementId: string): void {
  if (!active) return
  try {
    const frag = active.doc.getXmlFragment(fragmentKey(elementId))
    if (frag.length === 0) return
    frag.delete(0, frag.length)
  } catch (err) {
    // Defensive — never let a Yjs cleanup error tear down the structural
    // delete that triggered it.
    // eslint-disable-next-line no-console
    console.warn('[yjs] failed to clear fragment for element', elementId, err)
  }
}

/** Bulk variant for batch deletes / page removals. Single Yjs transaction so
 *  peers receive a coalesced update rather than N separate ones. */
export function clearYFragmentsForElements(elementIds: readonly string[]): void {
  if (!active || elementIds.length === 0) return
  const doc = active.doc
  doc.transact(() => {
    for (const id of elementIds) {
      try {
        const frag = doc.getXmlFragment(fragmentKey(id))
        if (frag.length > 0) frag.delete(0, frag.length)
      } catch {
        // continue — one bad id shouldn't abort the others
      }
    }
  })
}

export interface ConnectYDocOptions {
  /**
   * Wire the doc to STOMP. Default true.
   *
   * <p>Pass `false` for the anonymous try-a-template sandbox, which has no
   * session and therefore no websocket. Registering the transport anyway is
   * *nearly* harmless — every send is already a guarded no-op while
   * `currentClient` is null — but the 60s compaction timer would keep
   * re-encoding the whole document forever to feed that no-op, which on a
   * tab left open all day is real CPU spent on nothing.
   *
   * <p>What this flag never skips is creating the doc and assigning `active`.
   * That part is mandatory even offline: `getYDoc` mints a *fresh* `Y.Doc` on
   * every call while `active` is null, and `EditorCanvas` calls `getYFragment`
   * during render — so with no active provider each render yields a new
   * fragment identity, TipTap's `extensions` memo invalidates, and `useEditor`
   * tears down and rebuilds the editor on every keystroke.
   */
  transport?: boolean
}

/**
 * Create the session's Y.Doc, and (by default) bind it to the STOMP transport.
 *
 * Call once per editor session, after bindCollabBus has connected. Registers
 * inbound update/state listeners, observes local Y.Doc updates and pushes them
 * over STOMP, and schedules periodic compaction.
 */
export function connectYDoc(templateId: string, opts?: ConnectYDocOptions): Y.Doc {
  if (active?.templateId === templateId) return active.doc

  if (active) {
    disconnectYDoc()
  }

  const doc = new Y.Doc()

  if (opts?.transport === false) {
    // Local-only: the doc exists and is `active`, so fragment identity is
    // stable across renders, but nothing is sent, received or scheduled.
    active = {
      templateId,
      doc,
      teardown: () => {
        try { doc.destroy() } catch { /* ignore */ }
      },
    }
    return doc
  }

  const myUserId = ownUserId()

  // ── Outbound: local Y.Doc mutations → STOMP update broadcast ───────────────
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Skip our own applied remote updates (they use a sentinel origin).
    if (origin === REMOTE_ORIGIN) return
    try {
      sendYjsUpdate(uint8ArrayToBase64(update))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[yjs] failed to send update:', err)
    }
  }
  doc.on('update', onDocUpdate)

  // ── Inbound: remote updates → apply to local Y.Doc ─────────────────────────
  const offUpdate = onYjsUpdate((msg) => {
    // Drop our own echo — the server fan-outs to every subscriber.
    if (myUserId && msg.userId === myUserId) return
    try {
      const bytes = base64ToUint8Array(msg.update)
      Y.applyUpdate(doc, bytes, REMOTE_ORIGIN)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[yjs] failed to apply remote update:', err)
    }
  })

  // ── State hydration: ask server and apply whatever comes back ──────────────
  const offState = onYjsState((msg) => {
    try {
      if (msg.state) {
        Y.applyUpdate(doc, base64ToUint8Array(msg.state), REMOTE_ORIGIN)
      }
      if (Array.isArray(msg.updates)) {
        for (const u of msg.updates) {
          if (!u) continue
          Y.applyUpdate(doc, base64ToUint8Array(u), REMOTE_ORIGIN)
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[yjs] failed to apply snapshot state:', err)
    }
  })

  // Ask for the current state immediately so any late-joiner catches up.
  requestYjsState()

  // ── Periodic compaction ────────────────────────────────────────────────────
  let localChanges = 0
  const onLocalChangeForCompaction = (_update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN) localChanges++
  }
  doc.on('update', onLocalChangeForCompaction)

  const compactTimer = window.setInterval(() => {
    // Only compact when we've produced new local writes since the last snapshot.
    if (localChanges === 0) return
    localChanges = 0
    try {
      const full = Y.encodeStateAsUpdate(doc)
      sendYjsSnapshot(uint8ArrayToBase64(full))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[yjs] snapshot send failed:', err)
    }
  }, COMPACT_INTERVAL_MS)

  active = {
    templateId,
    doc,
    teardown: () => {
      window.clearInterval(compactTimer)
      offUpdate()
      offState()
      try { doc.off('update', onDocUpdate) } catch { /* ignore */ }
      try { doc.off('update', onLocalChangeForCompaction) } catch { /* ignore */ }
      try { doc.destroy() } catch { /* ignore */ }
    },
  }
  return doc
}

/** Tear down the current Y.Doc + listeners. Idempotent. */
export function disconnectYDoc(): void {
  if (!active) return
  active.teardown()
  active = null
}

/**
 * True when a Y.Doc is currently active for this template — used by the
 * structural diff observer to skip emitting `content` ops for TEXT elements
 * (Yjs owns that field while connected).
 */
export function isYDocActive(templateId: string | null): boolean {
  return !!active && !!templateId && active.templateId === templateId
}

// ── Internals ────────────────────────────────────────────────────────────────

const REMOTE_ORIGIN = Symbol('y-remote')

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Avoid apply(null, bytes) for huge arrays — chunk to keep stack safe.
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64)
  const len = binary.length
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i)
  return out
}
