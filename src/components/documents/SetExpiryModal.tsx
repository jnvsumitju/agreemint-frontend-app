import { useEffect, useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { endOfDayUtc } from '../../lib/api'

export interface SetExpiryModalProps {
  open: boolean
  onClose: () => void
  /** Current expiry as an ISO instant, or null when the document has none. */
  currentExpiresAt: string | null
  onSave: (expiresAt: string | null) => Promise<void>
}

/** `yyyy-mm-dd` for a date input, in UTC to match how the value is stored. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/** Today in UTC, as the `min` for the picker. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Set or remove a document's expiration date.
 *
 * <p>The date the user picks is resolved to end-of-day UTC before it is sent —
 * see {@link endOfDayUtc}. Choosing "31 Dec" and having the document expire at
 * midnight *starting* the 31st would lose them a day they thought they had.
 */
export function SetExpiryModal({
  open,
  onClose,
  currentExpiresAt,
  onSave,
}: SetExpiryModalProps) {
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed each time it opens, so cancelling and reopening does not show the
  // abandoned edit as though it had been saved.
  useEffect(() => {
    if (open) {
      setDate(toDateInputValue(currentExpiresAt))
      setError(null)
    }
  }, [open, currentExpiresAt])

  const submit = async (value: string | null) => {
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Could not update the expiration date')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Expiration date"
      description="The document moves to Expired on this date. We email the owner ahead of time."
      size="sm"
    >
      <label
        htmlFor="expiry-date"
        className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Expires on
      </label>
      <input
        id="expiry-date"
        type="date"
        value={date}
        min={todayUtc()}
        onChange={(e) => setDate(e.target.value)}
        disabled={saving}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Expires at the end of this day, UTC.
      </p>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <ModalFooter>
        {/* Removing an expiry is a distinct intent from changing one, so it gets
            its own control rather than being hidden behind clearing the field. */}
        {currentExpiresAt ? (
          <Button
            type="button"
            variant="danger-ghost"
            size="sm"
            onClick={() => void submit(null)}
            disabled={saving}
          >
            Remove expiry
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          loading={saving}
          disabled={!date}
          onClick={() => void submit(endOfDayUtc(date))}
        >
          Save
        </Button>
      </ModalFooter>
    </Modal>
  )
}
