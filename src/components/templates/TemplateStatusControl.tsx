import { usePermissions } from '../../hooks/usePermissions'
import type { TemplateStatus } from '../../lib/api'

/**
 * Move a template between DRAFT / ACTIVE / ARCHIVED.
 *
 * <p>Always visible rather than revealed on hover. The first version lived in
 * the card's hover overlay beside Duplicate and Delete, which was the wrong
 * company: those are occasional housekeeping, while whether a template can
 * produce a document at all is the first thing you want to know and change. It
 * was also absent from the row view entirely.
 *
 * <p>Shown only to ADMIN and REVIEWER, mirroring the server gate. A DESIGNER
 * can edit every pixel of a template and cannot put it into use — building is
 * not approving. Hidden rather than shown-and-403'd, since a control that
 * always fails is worse than no control.
 */
export function TemplateStatusControl({
  status,
  busy,
  onChange,
  size = 'sm',
}: {
  status: TemplateStatus
  busy: boolean
  onChange: (next: TemplateStatus) => void
  size?: 'sm' | 'xs'
}) {
  const { canChangeTemplateStatus } = usePermissions()
  if (!canChangeTemplateStatus) return null

  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'

  /** The transition you would actually want next, not a menu of three states. */
  const primary: { label: string; next: TemplateStatus; title: string } =
    status === 'ACTIVE'
      ? {
          label: 'Unpublish',
          next: 'DRAFT',
          title: 'Move back to Draft — generation will be refused',
        }
      : status === 'ARCHIVED'
      ? { label: 'Restore', next: 'DRAFT', title: 'Bring this template back as a draft' }
      : { label: 'Activate', next: 'ACTIVE', title: 'Allow documents to be generated from it' }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={busy}
        title={primary.title}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onChange(primary.next)
        }}
        className={`rounded-md border border-violet-300 font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-500/40 dark:text-violet-300 dark:hover:bg-violet-500/10 ${pad}`}
      >
        {busy ? '…' : primary.label}
      </button>

      {status !== 'ARCHIVED' && (
        <button
          type="button"
          disabled={busy}
          title="Archive — retires it without deleting the template or its documents"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onChange('ARCHIVED')
          }}
          className={`rounded-md border border-zinc-300 font-medium text-zinc-600 transition-colors hover:border-amber-300 hover:text-amber-700 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:text-amber-300 ${pad}`}
        >
          Archive
        </button>
      )}
    </div>
  )
}
