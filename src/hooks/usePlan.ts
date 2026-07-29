import { useAuthStore } from '../stores/authStore'

/**
 * The current organisation's plan.
 *
 * Mirrors the server-side PlanGate: approvals, document lifecycle and version
 * history are paid features. This hook only decides what to *show* — the server
 * is what actually enforces it, and returns 402 if the UI is bypassed.
 */
export interface PlanInfo {
  plan: string
  isFree: boolean
  /** True on any paid plan (PRO or ENTERPRISE). */
  isPaid: boolean
}

export function usePlan(): PlanInfo {
  const plan = useAuthStore((s) => s.org?.plan ?? 'FREE')
  return {
    plan,
    isFree: plan === 'FREE',
    isPaid: plan !== 'FREE',
  }
}
