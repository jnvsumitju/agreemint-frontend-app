import { useEffect, useState } from 'react'
import { createApiKey, type ApiKeyCreatedDto } from '../../lib/api'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'

/**
 * Two-stage API key creation dialog:
 *
 *   form → one-time reveal of the full secret → close
 *
 * The raw key returned in stage two is never retrievable later, so the UI
 * strongly encourages copying / downloading it before dismissing.
 */

const SCOPE_CATALOG: { value: string; label: string; description: string }[] = [
  {
    value: 'documents:generate',
    label: 'documents:generate',
    description: 'Generate a PDF from a template version',
  },
  {
    value: 'documents:read',
    label: 'documents:read',
    description: 'Read generated document metadata and download files',
  },
  {
    value: 'templates:read',
    label: 'templates:read',
    description: 'Read template metadata and list versions',
  },
  {
    value: 'webhooks:read',
    label: 'webhooks:read',
    description: 'List webhooks and delivery attempts',
  },
  {
    value: 'webhooks:write',
    label: 'webhooks:write',
    description: 'Create, update, and delete webhooks',
  },
]

const EXPIRY_OPTIONS = [
  { value: '', label: 'Never' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
]

export function CreateApiKeyModal({
  open, onClose, orgId, onCreated,
}: {
  open: boolean
  onClose: () => void
  orgId: string | null
  onCreated: () => void
}) {
  const toast = useToast()
  const [stage, setStage] = useState<'form' | 'reveal'>('form')
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<string>>(new Set(['documents:generate']))
  const [expiry, setExpiry] = useState('')
  const [allowedIps, setAllowedIps] = useState('')
  const [rateLimit, setRateLimit] = useState('120')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<ApiKeyCreatedDto | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      // Reset state on close so a future open starts clean.
      setStage('form')
      setName('')
      setScopes(new Set(['documents:generate']))
      setExpiry('')
      setAllowedIps('')
      setRateLimit('120')
      setCreated(null)
      setCopied(false)
    }
  }, [open])

  function toggleScope(v: string) {
    setScopes((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    if (!name.trim()) return
    if (scopes.size === 0) {
      toast.error('Pick at least one scope')
      return
    }
    setSubmitting(true)
    try {
      const res = await createApiKey(orgId, {
        name: name.trim(),
        scopes: Array.from(scopes),
        expiresInDays: expiry ? parseInt(expiry, 10) : null,
        allowedIps: allowedIps.trim() || null,
        rateLimitRpm: Number(rateLimit) > 0 ? Number(rateLimit) : null,
      })
      setCreated(res)
      setStage('reveal')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  function copyRaw() {
    if (!created) return
    navigator.clipboard.writeText(created.rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadAsTxt() {
    if (!created) return
    const body = `Agreemint API key\nName: ${created.key.name}\nCreated: ${created.key.createdAt}\nScopes: ${created.key.scopes.join(', ')}\nSecret: ${created.rawKey}\n`
    const blob = new Blob([body], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agreemint-api-key-${created.key.keyLast4}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function finish() {
    setStage('form')
    setCreated(null)
    onCreated()
  }

  return (
    <Modal open={open} onClose={stage === 'reveal' ? finish : onClose} title={stage === 'form' ? 'Create API key' : 'Your API key'} size="lg">
      {stage === 'form' ? (
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Staging CI"
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Scopes</label>
            <div className="grid grid-cols-1 gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-700">
              {SCOPE_CATALOG.map((s) => {
                const checked = scopes.has(s.value)
                return (
                  <label
                    key={s.value}
                    className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[12px] transition-colors ${
                      checked ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-violet-600"
                      checked={checked}
                      onChange={() => toggleScope(s.value)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{s.label}</span>
                      <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{s.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Expires"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              options={EXPIRY_OPTIONS}
            />
            <Input
              label="Rate limit (req/min)"
              type="number"
              min={1}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
            />
          </div>

          <Input
            label="Allowed IPs (optional)"
            value={allowedIps}
            onChange={(e) => setAllowedIps(e.target.value)}
            placeholder="203.0.113.0/24, 198.51.100.7"
          />
          <p className="-mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Comma-separated CIDR blocks. Leave empty to allow any source IP.
          </p>

          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!name.trim() || scopes.size === 0}>
              Create key
            </Button>
          </ModalFooter>
        </form>
      ) : created ? (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
            Copy this key now — it won't be shown again. Store it in your secret manager.
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Secret</label>
            <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-900 dark:text-zinc-100">
                {created.rawKey}
              </code>
              <Button size="xs" variant="secondary" onClick={copyRaw}>{copied ? 'Copied!' : 'Copy'}</Button>
              <Button size="xs" variant="secondary" onClick={downloadAsTxt}>Download</Button>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Name</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-100">{created.key.name}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Scopes</dt>
              <dd className="font-mono text-zinc-900 dark:text-zinc-100">{created.key.scopes.join(', ')}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Expires</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">
                {created.key.expiresAt ? new Date(created.key.expiresAt).toLocaleString() : 'Never'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Rate limit</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{created.key.rateLimitRpm} req/min</dd>
            </div>
          </dl>

          <ModalFooter>
            <Button variant="primary" size="sm" onClick={finish}>
              I've saved the key
            </Button>
          </ModalFooter>
        </div>
      ) : null}
    </Modal>
  )
}
