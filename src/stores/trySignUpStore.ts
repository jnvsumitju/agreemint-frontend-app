import { create } from 'zustand'

/**
 * Why the visitor was stopped. Drives the modal's copy — "sign up" reads very
 * differently depending on whether they clicked Save or Download.
 */
export type TrySignUpReason = 'save' | 'download' | 'preview'

interface TrySignUpState {
  reason: TrySignUpReason | null
  promptSignUp: (reason: TrySignUpReason) => void
  dismiss: () => void
}

/**
 * The sign-up wall for anonymous try-a-template sessions.
 *
 * <p>A separate one-field store rather than a field on `editorStore` or a React
 * context, because the trigger and the renderer sit on opposite sides of the
 * shared editor chrome: `Toolbar` (used by both the real editor and the
 * sandbox) raises it, and `TryTemplateEditor` (sandbox only) renders it.
 * Nothing in the authenticated editor ever writes here.
 */
export const useTrySignUpStore = create<TrySignUpState>((set) => ({
  reason: null,
  promptSignUp: (reason) => set({ reason }),
  dismiss: () => set({ reason: null }),
}))
