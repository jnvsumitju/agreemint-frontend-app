/**
 * Razorpay Checkout loader.
 *
 * The script is fetched on demand rather than in index.html: almost nobody
 * visits the billing tab, and Razorpay's bundle is not small. Loading it here
 * keeps it off the critical path for every other page.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void }
  }
}

export interface RazorpayHandlerResponse {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

export interface RazorpayOptions {
  key: string
  subscription_id: string
  name: string
  description?: string
  handler: (response: RazorpayHandlerResponse) => void
  prefill?: { name?: string; email?: string }
  notes?: Record<string, string>
  theme?: { color?: string }
  modal?: { ondismiss?: () => void }
}

let loading: Promise<void> | null = null

/** Load checkout.js once; concurrent callers share the same promise. */
export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve()
  if (loading) return loading

  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay')))
      return
    }

    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this is usually a blocked network or an ad blocker.
      loading = null
      reject(new Error('Failed to load Razorpay Checkout'))
    }
    document.body.appendChild(script)
  })

  return loading
}

export async function openRazorpayCheckout(options: RazorpayOptions): Promise<void> {
  await loadRazorpayCheckout()
  if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable')
  new window.Razorpay(options).open()
}
