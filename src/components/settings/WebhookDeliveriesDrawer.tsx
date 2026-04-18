import { useCallback, useEffect, useState } from 'react'
import { listWebhookDeliveries, type WebhookDeliveryDto } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { Badge } from '../ui/Badge'

/**
 * Read-only list of the 50 most recent delivery attempts for a webhook.
 * Invaluable when a customer is debugging a failing integration — they can see
 * HTTP status, error text, and per-attempt timestamps at a glance.
 */
export function WebhookDeliveriesDrawer({
  open, onClose, orgId, webhookId, webhookUrl,
}: {
  open: boolean
  onClose: () => void
  orgId: string | null
  webhookId: string | null
  webhookUrl: string
}) {
  const [rows, setRows] = useState<WebhookDeliveryDto[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!orgId || !webhookId) return
    setLoading(true)
    try {
      setRows(await listWebhookDeliveries(orgId, webhookId, 50))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [orgId, webhookId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  return (
    <Modal open={open} onClose={onClose} title="Recent deliveries" size="lg">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{webhookUrl}</p>
      <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        {loading ? (
          <div className="py-6 text-center text-sm text-zinc-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No deliveries yet. Trigger an event (e.g. commit a version, generate a PDF) to see one here.
          </div>
        ) : (
          <table className="min-w-full text-[12px]">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/60">
              <tr className="text-left uppercase tracking-wider text-[10px] text-zinc-500 dark:text-zinc-400">
                <th className="px-2 py-1.5">When</th>
                <th className="px-2 py-1.5">Event</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Attempt</th>
                <th className="px-2 py-1.5">Code</th>
                <th className="px-2 py-1.5">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{r.event}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={statusVariant(r.status)} size="sm">{r.status}</Badge>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-zinc-600 dark:text-zinc-400">{r.attempt}/{r.maxAttempts}</td>
                  <td className="px-2 py-1.5 tabular-nums text-zinc-600 dark:text-zinc-400">{r.responseCode ?? '—'}</td>
                  <td className="px-2 py-1.5 max-w-[14rem] truncate text-red-600 dark:text-red-400" title={r.error ?? ''}>
                    {r.error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}

function statusVariant(s: WebhookDeliveryDto['status']): 'success' | 'warning' | 'danger' | 'default' {
  switch (s) {
    case 'SUCCEEDED': return 'success'
    case 'PENDING':   return 'warning'
    case 'FAILED':    return 'danger'
    case 'ABANDONED': return 'default'
  }
}
