import { create } from 'zustand'
import {
  fetchDocuments,
  fetchDocumentLifecycle,
  transitionDocumentStatus,
  setDocumentExpiry,
  fetchLifecycleStats,
  fetchPendingApprovals,
  type DocumentLifecycleDto,
  type DocumentDetailDto,
  type DocumentSource,
  type LifecycleStatsDto,
  type PendingApprovalDto,
  type LifecycleStatus,
} from '../lib/api'

interface DocumentState {
  documents: DocumentLifecycleDto[]
  currentDocument: DocumentDetailDto | null
  stats: LifecycleStatsDto | null
  pendingApprovals: PendingApprovalDto[]
  filterStatus: LifecycleStatus | null
  /**
   * UI-vs-API tab selector. `null` means "both"; this stays null for users
   * who don't hit the Documents page, so nothing regresses for existing
   * flows.
   */
  filterSource: DocumentSource | null
  isLoading: boolean
  error: string | null

  fetchDocuments: (status?: LifecycleStatus, source?: DocumentSource | null) => Promise<void>
  fetchDocumentDetail: (id: string) => Promise<void>
  fetchStats: () => Promise<void>
  fetchPendingApprovals: () => Promise<void>
  transitionStatus: (id: string, target: LifecycleStatus, comment?: string) => Promise<void>
  /** `expiresAt` is an absolute instant, or null to remove the expiry. */
  setExpiry: (id: string, expiresAt: string | null) => Promise<void>
  setFilterStatus: (status: LifecycleStatus | null) => void
  setFilterSource: (source: DocumentSource | null) => void
  clearCurrentDocument: () => void
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  currentDocument: null,
  stats: null,
  pendingApprovals: [],
  filterStatus: null,
  filterSource: null,
  isLoading: false,
  error: null,

  fetchDocuments: async (status?: LifecycleStatus, source?: DocumentSource | null) => {
    set({ isLoading: true, error: null })
    try {
      // API-source docs have a null lifecycleStatus, so ignoring the status
      // filter when the user's on the API tab keeps the list non-empty.
      const effectiveSource = source === undefined ? get().filterSource : source
      const effectiveStatus = effectiveSource === 'API_GENERATED'
        ? undefined
        : (status ?? get().filterStatus ?? undefined)
      const docs = await fetchDocuments(
        effectiveStatus,
        effectiveSource ?? undefined,
      )
      set({ documents: docs, isLoading: false })
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false })
    }
  },

  fetchDocumentDetail: async (id: string) => {
    set({ isLoading: true, error: null })
    try {
      const detail = await fetchDocumentLifecycle(id)
      set({ currentDocument: detail, isLoading: false })
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false })
    }
  },

  fetchStats: async () => {
    try {
      const stats = await fetchLifecycleStats()
      set({ stats })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  fetchPendingApprovals: async () => {
    try {
      const approvals = await fetchPendingApprovals()
      set({ pendingApprovals: approvals })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  transitionStatus: async (id: string, target: LifecycleStatus, comment?: string) => {
    set({ isLoading: true, error: null })
    try {
      await transitionDocumentStatus(id, target, comment)
      // Refresh current document and list
      await get().fetchDocumentDetail(id)
      await get().fetchDocuments()
      await get().fetchStats()
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false })
    }
  },

  setExpiry: async (id: string, expiresAt: string | null) => {
    // Deliberately does NOT touch `isLoading`. DocumentDetail early-returns a
    // full-page skeleton while that flag is set, which unmounted the expiry
    // modal the instant Save was pressed: a rejected save then set state on a
    // dead component, the modal remounted seeded with the OLD date, and the
    // user saw no error at all — the failure looked like a success. The modal
    // owns its own saving/error state; this action only reports the outcome.
    set({ error: null })
    try {
      await setDocumentExpiry(id, expiresAt)
      // The detail view shows the date and the timeline shows the EXPIRY_SET
      // event, so both have to be re-read; the list carries an Expires column.
      await get().fetchDocumentDetail(id)
      await get().fetchDocuments()
    } catch (e) {
      set({ error: (e as Error).message })
      throw e
    }
  },

  setFilterStatus: (status: LifecycleStatus | null) => {
    set({ filterStatus: status })
    get().fetchDocuments(status ?? undefined)
  },

  setFilterSource: (source: DocumentSource | null) => {
    // Clear the status sub-filter when switching away from the UI tab so the
    // API list shows all rows instead of filtering by a status that doesn't
    // exist for API docs.
    set({
      filterSource: source,
      filterStatus: source === 'API_GENERATED' ? null : get().filterStatus,
    })
    get().fetchDocuments(undefined, source)
  },

  clearCurrentDocument: () => set({ currentDocument: null }),
}))
