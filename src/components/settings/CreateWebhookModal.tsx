import { useEffect, useState } from 'react'
import { createWebhook, type WebhookCreatedDto } from '../../lib/api'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useToast } from '../ui/Toast'

/**
 * Webhook creation dialog — mirrors the two-stage pattern used by API keys.
 *
 *   form → one-time signing-secret reveal → close
 *
 * Customers sign their verification with this secret; if they miss the
 * reveal they have to revoke + recreate.
 */

const EVENT_CATALOG: { value: string; label: string; description: string }[] = [
  { value: 'document.generated',  label: 'document.generated',  description: 'A PDF document finished rendering.' },
  { value: 'review.requested',    label: 'review.requested',    description: 'A reviewer has been asked to review a committed version.' },
  { value: 'review.decided',      label: 'review.decided',      description: 'A reviewer approved or requested changes.' },
  { value: 'template.version.committed', label: 'template.version.committed', description: 'A new template version was committed.' },
]

export function CreateWebhookModal({
  open, onClose, orgId, onCreated,
}: {
  open: boolean
  onClose: () => void
  orgId: string | null
  onCreated: () => void
}) {
  const toast = useToast()
  const [stage, setStage] = useState<'form' | 'reveal'>('form')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<Set<string>>(new Set(['document.generated']))
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<WebhookCreatedDto | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setStage('form')
      setUrl('')
      setEvents(new Set(['document.generated']))
      setCreated(null)
      setCopied(false)
    }
  }, [open])

  function toggleEvent(v: string) {
    setEvents((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    if (!url.trim()) return
    if (events.size === 0) {
      toast.error('Pick at least one event')
      return
    }
    setSubmitting(true)
    try {
      const res = await createWebhook(orgId, url.trim(), Array.from(events))
      setCreated(res)
      setStage('reveal')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  function copySecret() {
    if (!created) return
    navigator.clipboard.writeText(created.secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function finish() {
    setStage('form')
    setCreated(null)
    onCreated()
  }

  return (
    <Modal open={open} onClose={stage === 'reveal' ? finish : onClose} title={stage === 'form' ? 'Create webhook' : 'Your signing secret'} size="lg">
      {stage === 'form' ? (
        <form onSubmit={submit} className="space-y-4">
          <Input
            label="URL"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.example.com/webhooks/agreemint"
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Events</label>
            <div className="grid grid-cols-1 gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-700">
              {EVENT_CATALOG.map((e) => {
                const checked = events.has(e.value)
                return (
                  <label
                    key={e.value}
                    className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[12px] transition-colors ${
                      checked ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-violet-600"
                      checked={checked}
                      onChange={() => toggleEvent(e.value)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{e.label}</span>
                      <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{e.description}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!url.trim() || events.size === 0}>
              Create
            </Button>
          </ModalFooter>
        </form>
      ) : created ? (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
            Save this signing secret now. You'll use it to verify the <code>X-Agreemint-Signature</code> header on every delivery.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Signing secret</label>
            <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-900 dark:text-zinc-100">
                {created.secret}
              </code>
              <Button size="xs" variant="secondary" onClick={copySecret}>{copied ? 'Copied!' : 'Copy'}</Button>
            </div>
          </div>
          <div className="rounded-md bg-zinc-900 p-3 text-[11px] leading-snug text-zinc-100">
            <div className="mb-1 text-zinc-400">Verification (Python):</div>
            <pre>{`import hmac, hashlib
sig = request.headers["X-Agreemint-Signature"]  # e.g. "t=...,v1=..."
ts, v1 = [s.split("=")[1] for s in sig.split(",")]
expected = hmac.new(SECRET.encode(), f"{ts}.{request.body}".encode(), hashlib.sha256).hexdigest()
assert hmac.compare_digest(expected, v1)`}</pre>
          </div>
          <ModalFooter>
            <Button variant="primary" size="sm" onClick={finish}>I've saved the secret</Button>
          </ModalFooter>
        </div>
      ) : null}
    </Modal>
  )
}
