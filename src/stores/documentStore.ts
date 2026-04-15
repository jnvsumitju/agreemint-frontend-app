import { create } from 'zustand'
import {
  fetchDocuments,
  fetchDocumentLifecycle,
  transitionDocumentStatus,
  fetchLifecycleStats,
  fetchPendingApprovals,
  type DocumentLifecycleDto,
  type DocumentDetailDto,
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
  isLoading: boolean
  error: string | null

  fetchDocuments: (status?: LifecycleStatus) => Promise<void>
  fetchDocumentDetail: (id: string) => Promise<void>
  fetchStats: () => Promise<void>
  fetchPendingApprovals: () => Promise<void>
  transitionStatus: (id: string, target: LifecycleStatus, comment?: string) => Promise<void>
  setFilterStatus: (status: LifecycleStatus | null) => void
  clearCurrentDocument: () => void
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  currentDocument: null,
  stats: null,
  pendingApprovals: [],
  filterStatus: null,
  isLoading: false,
  error: null,

  fetchDocuments: async (status?: LifecycleStatus) => {
    set({ isLoading: true, error: null })
    try {
      const docs = await fetchDocuments(status ?? get().filterStatus ?? undefined)
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

  setFilterStatus: (status: LifecycleStatus | null) => {
    set({ filterStatus: status })
    get().fetchDocuments(status ?? undefined)
  },

  clearCurrentDocument: () => set({ currentDocument: null }),
}))
