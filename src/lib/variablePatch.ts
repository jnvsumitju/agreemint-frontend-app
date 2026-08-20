/**
 * What one editor asserts when it saves its variable values.
 *
 * <p>Lives here rather than in `api.ts` because it is pure: importing it should
 * not drag in `authStore`, which reads `sessionStorage` at module load and so
 * cannot be loaded outside a browser.
 */

/** Keys whose value changed or appeared, and keys that went away. */
export function diffVariableValues(
  before: Record<string, string>,
  after: Record<string, string>
): { set: Record<string, string>; remove: string[] } {
  const set: Record<string, string> = {}
  for (const [k, v] of Object.entries(after)) {
    if (before[k] !== v) set[k] = v
  }
  const remove = Object.keys(before).filter((k) => !(k in after))
  return { set, remove }
}
