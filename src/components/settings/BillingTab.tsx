import { useCallback, useEffect, useState } from 'react'
import {
  fetchBillingStatus,
  createSubscription,
  confirmSubscription,
  cancelSubscription,
  listPayments,
  type BillingStatusDto,
  type PaymentRecordDto,
} from '../../lib/api'
import { openRazorpayCheckout } from '../../lib/razorpay'
import { useAuthStore } from '../../stores/authStore'
import { Button, Badge, useToast } from '../ui'

/**
 * Settings → Billing. ADMIN-only, same as the Developer tab — this spends the
 * workspace's money.
 *
 * The plan shown here is whatever the server says; it is granted by Razorpay's
 * webhook, not by anything this component does. After checkout we poll briefly,
 * because the webhook and the browser callback race and the webhook usually
 * wins by a second or two.
 */

/** How the org's live subscription status should read to a human. */
const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'default' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  AUTHENTICATED: { label: 'Starting', tone: 'default' },
  CREATED: { label: 'Awaiting payment', tone: 'default' },
  PENDING: { label: 'Payment retrying', tone: 'warning' },
  HALTED: { label: 'Payment failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'default' },
  COMPLETED: { label: 'Completed', tone: 'default' },
  EXPIRED: { label: 'Expired', tone: 'default' },
}

function formatAmount(paise: number | null, currency: string | null): string {
  if (paise == null) return '—'
  // Razorpay returns the smallest currency unit; INR is the common case here.
  const major = paise / 100
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency ?? 'INR',
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `${major} ${currency ?? ''}`.trim()
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function BillingTab() {
  const toast = useToast()
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const orgName = useAuthStore((s) => s.org?.name ?? 'Crixaa')
  const user = useAuthStore((s) => s.user)

  const [status, setStatus] = useState<BillingStatusDto | null>(null)
  const [payments, setPayments] = useState<PaymentRecordDto[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'MONTHLY' | 'YEARLY' | 'cancel' | null>(null)

  const refresh = useCallback(async () => {
    if (!orgId) return
    try {
      const next = await fetchBillingStatus(orgId)
      setStatus(next)
      if (next.subscription) {
        setPayments(await listPayments(orgId).catch(() => []))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load billing')
    } finally {
      setLoading(false)
    }
  }, [orgId, toast])

  useEffect(() => { void refresh() }, [refresh])

  /**
   * Poll for the webhook to land. Checkout returns before Razorpay has told our
   * server anything, so without this the tab would sit on the old plan until a
   * manual refresh.
   */
  const waitForActivation = useCallback(async () => {
    if (!orgId) return
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const next = await fetchBillingStatus(orgId)
        setStatus(next)
        if (next.subscription?.status === 'ACTIVE') {
          setPayments(await listPayments(orgId).catch(() => []))
          toast.success('Subscription active — your workspace is on Pro')
          return
        }
      } catch {
        // Keep polling; a transient failure here is not worth surfacing.
      }
    }
    toast.info('Payment received. Activation can take a moment — refresh shortly.')
  }, [orgId, toast])

  async function handleUpgrade(period: 'MONTHLY' | 'YEARLY') {
    if (!orgId || busy) return
    setBusy(period)
    try {
      const created = await createSubscription(orgId, period)

      await openRazorpayCheckout({
        key: created.razorpayKeyId,
        subscription_id: created.razorpaySubscriptionId,
        name: 'Crixaa',
        description: `Pro — billed ${period === 'YEARLY' ? 'yearly' : 'monthly'}`,
        prefill: { name: user?.name ?? undefined, email: user?.email ?? undefined },
        notes: { org: orgName },
        theme: { color: '#7c3aed' },
        handler: (response) => {
          // Best-effort verification for immediate feedback. Even if this call
          // fails, the webhook still grants the plan.
          void confirmSubscription(orgId, {
            razorpaySubscriptionId: response.razorpay_subscription_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          })
            .catch(() => { /* webhook is the authority */ })
            .finally(() => { void waitForActivation() })
        },
        modal: {
          ondismiss: () => {
            setBusy(null)
            // The subscription row stays in `created`; refresh so the UI shows
            // it rather than pretending nothing happened.
            void refresh()
          },
        },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start checkout')
    } finally {
      setBusy(null)
    }
  }

  async function handleCancel() {
    if (!orgId || busy) return
    if (!confirm('Cancel this subscription? You keep Pro until the end of the period you have paid for.')) return
    setBusy('cancel')
    try {
      await cancelSubscription(orgId, false)
      toast.success('Subscription will end at the close of this billing period')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading billing…</p>
  }

  if (!status) return null

  const sub = status.subscription
  const statusMeta = sub ? STATUS_LABEL[sub.status] ?? { label: sub.status, tone: 'default' as const } : null
  const hasLiveSub = sub != null && ['ACTIVE', 'AUTHENTICATED', 'PENDING', 'HALTED'].includes(sub.status)

  return (
    <div className="space-y-8">
      {/* ── Current plan ── */}
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Current plan</h2>
          <Badge variant={status.plan === 'FREE' ? 'default' : 'primary'}>{status.plan}</Badge>
          {statusMeta && <Badge variant={statusMeta.tone}>{statusMeta.label}</Badge>}
        </div>

        {sub && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Billing period</dt>
              <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                {sub.billingPeriod === 'YEARLY' ? 'Yearly' : 'Monthly'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">
                {sub.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}
              </dt>
              <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                {formatDate(sub.currentPeriodEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Subscription</dt>
              <dd className="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {sub.razorpaySubscriptionId}
              </dd>
            </div>
          </dl>
        )}

        {sub?.status === 'HALTED' && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            We could not collect your last payment and retries are exhausted. Your workspace has
            returned to the Free plan. Start a new subscription to restore Pro.
          </p>
        )}
        {sub?.status === 'PENDING' && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            A renewal payment did not go through. Razorpay is retrying — your access continues in
            the meantime. Check the card on file if this persists.
          </p>
        )}
        {sub?.cancelAtPeriodEnd && (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            Cancellation scheduled. You keep Pro until {formatDate(sub.currentPeriodEnd)}.
          </p>
        )}
      </section>

      {/* ── Actions ── */}
      {!status.billingEnabled ? (
        <p className="rounded-lg border border-zinc-200 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Billing is not configured on this environment. Set the Razorpay credentials to enable
          upgrades.
        </p>
      ) : hasLiveSub ? (
        !sub?.cancelAtPeriodEnd && (
          <Button variant="danger-ghost" size="sm" onClick={() => void handleCancel()} disabled={busy !== null}>
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel subscription'}
          </Button>
        )
      ) : (
        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Upgrade to Pro</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Unlock the API, webhooks, approvals and version history for your whole workspace.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {status.monthlyAvailable && (
              <Button onClick={() => void handleUpgrade('MONTHLY')} disabled={busy !== null}>
                {busy === 'MONTHLY' ? 'Opening…' : 'Subscribe monthly'}
              </Button>
            )}
            {status.yearlyAvailable && (
              <Button
                variant="secondary"
                onClick={() => void handleUpgrade('YEARLY')}
                disabled={busy !== null}
              >
                {busy === 'YEARLY' ? 'Opening…' : 'Subscribe yearly'}
              </Button>
            )}
            {!status.monthlyAvailable && !status.yearlyAvailable && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No plans are configured yet. Add the Razorpay plan ids to enable checkout.
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            Payments are processed by Razorpay. We never see your card details.
          </p>
        </section>
      )}

      {/* ── Payment history ── */}
      {payments.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Payments</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {payments.map((p, i) => (
                  <tr key={p.paymentId ?? i}>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{formatDate(p.paidAt)}</td>
                    <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">
                      {formatAmount(p.amount, p.currency)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-500">
                      {p.paymentId ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
