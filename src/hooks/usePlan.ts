import { useAuthStore } from '../stores/authStore'

/**
 * The current organisation's plan, with tier comparison.
 *
 * Mirrors the server-side PlanGate. Tiers differ — version history is Starter
 * and up, approvals and lifecycle are Pro — so a plain "is it paid?" check
 * would show Starter customers features they did not buy.
 *
 * This only decides what to *show*; the server enforces it and returns 402 if
 * the UI is bypassed.
 */
export type PlanName = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

/** Must match the declaration order of OrgPlan on the backend. */
const RANK: Record<string, number> = {
  FREE: 0,
  STARTER: 1,
  PRO: 2,
  ENTERPRISE: 3,
}

export interface PlanInfo {
  plan: string
  isFree: boolean
  isPaid: boolean
  /** True when the current plan includes everything `minimum` grants. */
  atLeast: (minimum: PlanName) => boolean
}

export function usePlan(): PlanInfo {
  const plan = useAuthStore((s) => s.org?.plan ?? 'FREE')
  // An unknown plan name (older client, newer server) is treated as the
  // lowest tier rather than silently unlocking everything.
  const rank = RANK[plan] ?? 0

  return {
    plan,
    isFree: plan === 'FREE',
    isPaid: rank > 0,
    atLeast: (minimum: PlanName) => rank >= (RANK[minimum] ?? 0),
  }
}
