import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listApiKeys,
  listWebhooks,
  revokeApiKey,
  revokeWebhook,
  type ApiKeyDto,
  type WebhookDto,
} from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { CreateApiKeyModal } from './CreateApiKeyModal'
import { RotateApiKeyModal } from './RotateApiKeyModal'
import { CreateWebhookModal } from './CreateWebhookModal'
import { WebhookDeliveriesDrawer } from './WebhookDeliveriesDrawer'

/**
 * Settings → Developer tab. Lists org API keys with per-row actions
 * (copy-prefix, revoke, rotate coming in Phase 6). Opens the two-stage
 * {@link CreateApiKeyModal} for creation.
 */
export function DeveloperTab() {
  const toast = useToast()
  // No plan gate: the API is on every plan, free included, bounded by rate
  // limits rather than by a wall. What a lapsed paid plan does instead is start
  // a grace period, after which the keys minted under it are revoked — the
  // customer is emailed at both ends and can create a new key on free.
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const [keys, setKeys] = useState<ApiKeyDto[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [rotating, setRotating] = useState<ApiKeyDto | null>(null)

  const [webhooks, setWebhooks] = useState<WebhookDto[]>([])
  const [webhooksLoading, setWebhooksLoading] = useState(false)
  const [createWebhookOpen, setCreateWebhookOpen] = useState(false)
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookDto | null>(null)

  const refresh = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setKeys(await listApiKeys(orgId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }, [orgId, toast])

  const refreshWebhooks = useCallback(async () => {
    if (!orgId) return
    setWebhooksLoading(true)
    try {
      setWebhooks(await listWebhooks(orgId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load webhooks')
    } finally {
      setWebhooksLoading(false)
    }
  }, [orgId, toast])

  useEffect(() => { void refresh(); void refreshWebhooks() }, [refresh, refreshWebhooks])

  async function handleRevokeWebhook(w: WebhookDto) {
    if (!orgId) return
    if (!confirm(`Revoke webhook at "${w.url}"? Future events will stop being delivered.`)) return
    try {
      await revokeWebhook(orgId, w.id)
      toast.success('Webhook revoked')
      refreshWebhooks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  async function handleRevoke(k: ApiKeyDto) {
    if (!orgId) return
    if (!confirm(`Revoke "${k.name}"? Integrations using it will stop working immediately.`)) return
    try {
      await revokeApiKey(orgId, k.id)
      toast.success('Key revoked')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">API keys</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Authenticate programmatic requests to the <code className="rounded bg-zinc-100 px-1 text-[12px] dark:bg-zinc-800">/api/v1/*</code> endpoints.
              Secrets are shown once at creation — store them in your secret manager.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
            Create API key
          </Button>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
            <thead className="bg-zinc-50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Key</th>
                <th className="px-4 py-2 text-left">Scopes</th>
                <th className="px-4 py-2 text-left">Last used</th>
                <th className="px-4 py-2 text-left">Expires</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-400">Loading…</td></tr>
              )}
              {!loading && keys.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No API keys yet. Create one to start using the public API.
                </td></tr>
              )}
              {keys.map((k) => (
                <KeyRow
                  key={k.id}
                  k={k}
                  onRevoke={() => void handleRevoke(k)}
                  onRotate={() => setRotating(k)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Webhooks</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Receive HMAC-signed POSTs when events happen — new PDFs, review decisions, version commits.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreateWebhookOpen(true)}>
            Add webhook
          </Button>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
            <thead className="bg-zinc-50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 text-left">URL</th>
                <th className="px-4 py-2 text-left">Events</th>
                <th className="px-4 py-2 text-left">Secret</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {webhooksLoading && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-400">Loading…</td></tr>
              )}
              {!webhooksLoading && webhooks.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No webhooks yet. Add one to start receiving event notifications.
                </td></tr>
              )}
              {webhooks.map((w) => (
                <tr key={w.id} className={w.revokedAt ? 'opacity-50' : undefined}>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-700 dark:text-zinc-300 max-w-[18rem] truncate" title={w.url}>{w.url}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {w.events.map((e) => <Badge key={e} variant="info" size="sm">{e}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-600 dark:text-zinc-300">whsec_••••{w.secretLast4}</td>
                  <td className="px-4 py-2.5">
                    {w.revokedAt ? <Badge variant="default" size="sm">Revoked</Badge> : <Badge variant="success" size="sm">Active</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="text-[12px] font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400"
                        onClick={() => setDeliveriesFor(w)}
                      >
                        Deliveries
                      </button>
                      {!w.revokedAt && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeWebhook(w)}
                          className="text-[12px] font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CreateApiKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        orgId={orgId}
        onCreated={() => { setCreateOpen(false); refresh() }}
      />
      <RotateApiKeyModal
        open={Boolean(rotating)}
        onClose={() => setRotating(null)}
        orgId={orgId}
        oldKey={rotating}
        onRotated={() => { setRotating(null); refresh() }}
      />
      <CreateWebhookModal
        open={createWebhookOpen}
        onClose={() => setCreateWebhookOpen(false)}
        orgId={orgId}
        onCreated={() => { setCreateWebhookOpen(false); refreshWebhooks() }}
      />
      <WebhookDeliveriesDrawer
        open={Boolean(deliveriesFor)}
        onClose={() => setDeliveriesFor(null)}
        orgId={orgId}
        webhookId={deliveriesFor?.id ?? null}
        webhookUrl={deliveriesFor?.url ?? ''}
      />
    </div>
  )
}

function KeyRow({ k, onRevoke, onRotate }: { k: ApiKeyDto; onRevoke: () => void; onRotate: () => void }) {
  const expiryInfo = useMemo(() => expiryStatus(k.expiresAt), [k.expiresAt])
  const revoked = Boolean(k.revokedAt)
  return (
    <tr className={revoked ? 'opacity-50' : undefined}>
      <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
        {k.name}
        {revoked && <Badge variant="default" size="sm" className="ml-2">Revoked</Badge>}
      </td>
      <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-600 dark:text-zinc-300">
        {k.keyPrefix}_••••{k.keyLast4}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {k.scopes.map((s) => (
            <Badge key={s} variant="info" size="sm">{s}</Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-2.5 text-[12px] text-zinc-600 dark:text-zinc-300">
        {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
      </td>
      <td className="px-4 py-2.5 text-[12px]">
        {k.expiresAt ? (
          <span className={expiryInfo.warn ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-600 dark:text-zinc-300'}>
            {new Date(k.expiresAt).toLocaleDateString()}{expiryInfo.warn ? ` · ${expiryInfo.label}` : ''}
          </span>
        ) : (
          <span className="text-zinc-400">Never</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {!revoked && (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onRotate}
              className="text-[12px] font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400"
            >
              Rotate
            </button>
            <button
              type="button"
              onClick={onRevoke}
              className="text-[12px] font-medium text-red-600 hover:text-red-800 dark:text-red-400"
            >
              Revoke
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function expiryStatus(iso: string | null): { warn: boolean; label: string } {
  if (!iso) return { warn: false, label: '' }
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs < 0) return { warn: true, label: 'expired' }
  const days = Math.round(diffMs / 86_400_000)
  if (days <= 7) return { warn: true, label: `in ${days}d` }
  return { warn: false, label: '' }
}
