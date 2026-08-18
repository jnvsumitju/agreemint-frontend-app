/**
 * What "the template changed" means for the purpose of the preview image.
 *
 * <p>Layout AND values. The server renders the draft's variables into the page,
 * so re-typing an amount changes the image even though no element moved —
 * fingerprinting the layout alone would freeze the thumbnail for anyone whose
 * editing is mostly filling in the sample data, which is most people.
 *
 * <p>Its own module rather than a member of the hook that uses it, so a test
 * can reach it without dragging the API client and the auth store into a Node
 * environment that has no `sessionStorage`.
 */
export function thumbnailFingerprint(snapshot: {
  layout: Record<string, unknown>
  variableValues: Record<string, string>
}): string {
  return JSON.stringify({ l: snapshot.layout, v: snapshot.variableValues })
}
