import { useEffect, useState } from 'react'
import { rotateApiKey, type ApiKeyCreatedDto, type ApiKeyDto } from '../../lib/api'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'

/**
 * Rotation flow: create a successor key with the same scopes, leave the old
 * key alive for {@code graceDays} so integrations can swap over. Mirrors the
 * same two-stage (form → one-time reveal) pattern as creation.
 */
export function RotateApiKeyModal({
  open, onClose, orgId, oldKey, onRotated,
}: {
  open: boolean
  onClose: () => void
  orgId: string | null
  oldKey: ApiKeyDto | null
  onRotated: () => void
}) {
  const toast = useToast()
  const [stage, setStage] = useState<'form' | 'reveal'>('form')
  const [graceDays, setGraceDays] = useState('7')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<ApiKeyCreatedDto | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setStage('form')
      setGraceDays('7')
      setCreated(null)
      setCopied(false)
    }
  }, [open])

  async function rotate() {
    if (!orgId || !oldKey) return
    setSubmitting(true)
    try {
      const res = await rotateApiKey(orgId, oldKey.id, parseInt(graceDays, 10))
      setCreated(res)
      setStage('reveal')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rotate failed')
    } finally {
      setSubmitting(false)
    }
  }

  function copy() {
    if (!created) return
    navigator.clipboard.writeText(created.rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function finish() {
    setStage('form')
    setCreated(null)
    onRotated()
  }

  return (
    <Modal
      open={open}
      onClose={stage === 'reveal' ? finish : onClose}
      title={stage === 'form' ? 'Rotate API key' : 'Your new key'}
      size="lg"
    >
      {stage === 'form' && oldKey ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            We'll create a new key with the same scopes as <strong>{oldKey.name}</strong> and keep the old one active for the grace period. Swap your integration over before it expires.
          </p>
          <Select
            label="Grace period"
            value={graceDays}
            onChange={(e) => setGraceDays(e.target.value)}
            options={[
              { value: '1', label: '1 day' },
              { value: '3', label: '3 days' },
              { value: '7', label: '7 days (recommended)' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
          />
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" loading={submitting} onClick={() => void rotate()}>
              Create successor key
            </Button>
          </ModalFooter>
        </div>
      ) : created ? (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
            Copy this key and update your integration. The previous key continues to work until its grace expiry.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">New secret</label>
            <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-900 dark:text-zinc-100">{created.rawKey}</code>
              <Button size="xs" variant="secondary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</Button>
            </div>
          </div>
          <ModalFooter>
            <Button variant="primary" size="sm" onClick={finish}>Done</Button>
          </ModalFooter>
        </div>
      ) : null}
    </Modal>
  )
}
