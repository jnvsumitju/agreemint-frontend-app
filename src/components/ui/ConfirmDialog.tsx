import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal, ModalFooter } from './Modal'
import { Button, type ButtonProps } from './Button'

/**
 * In-app replacement for `window.confirm`.
 *
 * <p>The native dialog is rendered by the browser, so it arrives titled
 * "console.crixaa.com says", ignores the app's theme entirely, and cannot show
 * a destructive action as destructive. It also blocks the main thread, which is
 * why a confirm can appear before the UI behind it has finished painting.
 *
 * <p>Deliberately promise-based rather than a component with `open`/`onConfirm`
 * props. Every existing call site reads `if (!confirm(…)) return` at the top of
 * an async handler; keeping that shape means the control flow of six handlers
 * does not have to be turned inside out into state machines, and a seventh
 * cannot quietly go back to the native one because it was less effort.
 */

export interface ConfirmOptions {
  title: string
  /** Body copy. Say what will happen, in the user's terms. */
  description?: string
  /** Defaults to "Confirm". Prefer a verb that names the action. */
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` for anything destructive or irreversible. */
  variant?: ButtonProps['variant']
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  // Held in a ref rather than state: settling the promise must not depend on a
  // re-render having happened, or a fast double-click resolves the wrong one.
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second confirm while one is open would strand the first promise
      // forever, and an un-settled promise means a handler that never returns.
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setOptions(next)
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={options !== null}
        // Escape and the backdrop both mean "no" — the same as the native
        // dialog, and the safe reading for a destructive prompt.
        onClose={() => settle(false)}
        title={options?.title ?? ''}
        description={options?.description}
        size="sm"
      >
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => settle(false)}>
            {options?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={options?.variant ?? 'primary'}
            size="sm"
            onClick={() => settle(true)}
          >
            {options?.confirmLabel ?? 'Confirm'}
          </Button>
        </ModalFooter>
      </Modal>
    </ConfirmContext.Provider>
  )
}

/**
 * Ask the user to confirm something.
 *
 * <p>Resolves true only when they pick the confirm action; Escape, the
 * backdrop and Cancel all resolve false.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
