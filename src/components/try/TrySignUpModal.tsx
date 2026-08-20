import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useTrySignUpStore, type TrySignUpReason } from '../../stores/trySignUpStore'
import { markTryDraftForClaim } from '../../lib/trySession'

const COPY: Record<TrySignUpReason, { title: string; body: string; cta: string }> = {
  save: {
    title: 'Create a free account to save this',
    body: 'Your edits are held in this browser for now. Sign up and we will move this template straight into your new workspace — nothing to re-do.',
    cta: 'Sign up and save',
  },
  download: {
    title: 'You have used your free download',
    // Reached only AFTER a PDF has been taken, so it must not claim a download
    // needs an account — the visitor is holding one. What an account buys is
    // more of them, without the watermark.
    body: 'That one is yours to keep. Sign up free — no card — to generate more without the watermark, and this template comes with you.',
    cta: 'Sign up and download',
  },
}

/**
 * The wall between editing a template anonymously and doing anything that
 * needs a server: saving, previewing or downloading.
 *
 * <p>Marks the current draft for claim *before* navigating, so whichever way
 * registration completes — straight through, an emailed verification link, or
 * an OAuth round trip — there is a record on disk saying which template to
 * write into the new workspace.
 */
export function TrySignUpModal({ slug }: { slug: string }) {
  const reason = useTrySignUpStore((s) => s.reason)
  const dismiss = useTrySignUpStore((s) => s.dismiss)
  const navigate = useNavigate()

  const copy = reason ? COPY[reason] : null

  function go(path: string) {
    markTryDraftForClaim(slug)
    dismiss()
    navigate(path)
  }

  return (
    <Modal open={!!copy} onClose={dismiss} title={copy?.title} size="md">
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{copy?.body}</p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={dismiss}>
          Keep editing
        </Button>
        <Button variant="secondary" onClick={() => go('/login')}>
          I have an account
        </Button>
        <Button onClick={() => go('/register')}>{copy?.cta}</Button>
      </div>
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
        Prefer not to sign up? Use <span className="font-medium">File → Export JSON</span> to keep a
        copy of your work.
      </p>
    </Modal>
  )
}
