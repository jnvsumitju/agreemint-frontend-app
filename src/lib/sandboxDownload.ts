/**
 * The one free PDF a signed-out visitor may take from the /try sandbox.
 *
 * <p><b>This is a courtesy, not a control.</b> The flag lives in localStorage,
 * so clearing site data, opening a private window or using another browser
 * resets it, and nothing here is reachable by a script that talks to the API
 * directly. That is fine and deliberate: the person this is written for found a
 * relieving-letter template on Google and wants their document. The actual
 * ceiling on cost is the per-IP rate limit on
 * {@code POST /api/public/sandbox/pdf} — see SandboxPdfController in the
 * backend, which is explicit that the browser-side count is not relied upon.
 *
 * <p>Kept in its own module rather than on `editorStore` because it must
 * outlive the store: the whole point is that it survives a page reload, and a
 * value that persists has different rules from one that does not.
 */

const KEY = 'crixaa.try.freePdfUsed'

/** True once the visitor has taken their free download. */
export function hasUsedFreePdf(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Safari in private mode throws on localStorage access rather than
    // returning null. Treat that as "not used": a visitor who cannot be
    // tracked should get their document, not a sign-up wall.
    return false
  }
}

/** Record that it has been taken. Best-effort; failure just means they get another. */
export function markFreePdfUsed(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* see above — storage being unavailable must not break the download */
  }
}
