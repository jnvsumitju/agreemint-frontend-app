import { useEffect } from 'react'
import { connectYDoc, disconnectYDoc } from './yDocProvider'
import { usePresenceStore } from '../stores/presenceStore'

/**
 * The Y.Doc half of {@link useCollab}, with no transport and no diff observer.
 *
 * <p>Used by the anonymous try-a-template sandbox, which has no session and so
 * no websocket. It would be tempting to skip Yjs entirely here — nothing is
 * being collaborated on — but that breaks inline rich text outright rather than
 * merely degrading it:
 *
 * <p>`getYDoc` returns a brand-new `Y.Doc` on every call while no provider is
 * active. `EditorCanvas` calls `getYFragment(...)` *during render*, and
 * `TipTapRichEditor` memoises its `extensions` array on the fragment's
 * identity, which `useEditor` then watches. So with no provider: every render
 * mints a new doc → a new fragment → a new extensions array → TipTap destroys
 * and rebuilds the editor. And it feeds itself, because TipTap's `onUpdate`
 * writes back to the store, which re-renders. The caret dies on every
 * keystroke.
 *
 * <p>Registering a provider fixes it, because `Y.Doc.getXmlFragment(key)`
 * returns the cached top-level type, so identity holds across renders.
 *
 * <p>This deliberately does *not* call {@link useCollab}. Beyond the doc, that
 * hook installs a store subscriber which runs a full pages-vs-baseline diff on
 * every mutation and then hands each op to a send function that is a no-op
 * without a client — pure cost on every keystroke, for output nobody receives.
 */
export function useLocalYDoc(templateId: string | null) {
  useEffect(() => {
    if (!templateId) return

    // `usePresenceStore` is a module singleton and the sandbox never calls
    // `connectToTemplate`, so it never calls `disconnectFromTemplate` either.
    // A tab that previously held a real editor session would otherwise keep
    // showing that session's avatars and follow state next to a document
    // nobody else can see.
    usePresenceStore.setState({ users: [], viewports: {}, selections: {}, followingUserId: null })

    connectYDoc(templateId, { transport: false })
    return () => {
      disconnectYDoc()
    }
  }, [templateId])
}
