import type { TemplateDto, TemplateStatus as TemplateStatusValue } from './api'

/** Unused re-export guard so the API union stays the source of truth. */
export type { TemplateStatusValue }

export type TemplateStatusTone = 'warning' | 'success' | 'info' | 'default'

export interface TemplateStatus {
  label: string
  tone: TemplateStatusTone
  /** Shown on hover — says what the state means for generating documents. */
  title: string
}

/**
 * What the templates list should say about a template.
 *
 * <p>The badge here used to be the literal string "Draft", hardcoded at both
 * call sites and rendered for every template forever — including ones committed
 * months ago. It looked like state and carried none, so it could not be acted
 * on and could not be wrong in any visible way.
 *
 * <p>There is no status column behind this, and deliberately so: the lifecycle
 * already exists in the data. Committing promotes the draft to a numbered
 * version and deletes the draft row, so a draft's existence means "edits that
 * are in no version", and the absence of any version means "cannot generate
 * yet". Both are derived rather than stored, which is why they cannot drift
 * out of step with what the editor actually did.
 *
 * <p>The third state is the one worth having: a template showing v2 whose newer
 * edits were never committed. Documents generate from the committed version, so
 * those edits are not in the output — the previous UI gave no way to notice.
 */
export function templateStatus(
  t: Pick<TemplateDto, 'status' | 'versionNumber' | 'hasUncommittedChanges'>
): TemplateStatus {
  // The lifecycle state leads, because it is the one that decides whether this
  // template can produce a document at all. Version state is real too, but it
  // is detail about a template you can already use.
  switch (t.status) {
    case 'ARCHIVED':
      return {
        label: 'Archived',
        tone: 'default',
        title: 'Retired. Generation is refused until you restore it. Nothing has been deleted.',
      }
    case 'DRAFT':
      return {
        label: 'Draft',
        tone: 'warning',
        title: 'Not active yet — generation is refused. Set it to Active when it is ready.',
      }
    default:
      break
  }
  return {
    label: 'Active',
    tone: 'success',
    title: 'Documents can be generated from this template.',
  }
}

/**
 * Version state, shown alongside the lifecycle badge rather than instead of it.
 *
 * <p>The case worth surfacing is the third one: an ACTIVE template whose editor
 * changes were never committed. Documents generate from the committed version,
 * so those edits are not in the output — and nothing else in the product says
 * so.
 */
export function templateVersionNote(
  t: Pick<TemplateDto, 'versionNumber' | 'hasUncommittedChanges'>
): { label: string; title: string } | null {
  if (t.versionNumber == null) return null
  if (t.hasUncommittedChanges) {
    return {
      label: `v${t.versionNumber} · edited`,
      title:
        `Editor changes are not in v${t.versionNumber}. Documents generate from ` +
        `v${t.versionNumber} until you commit.`,
    }
  }
  return { label: `v${t.versionNumber}`, title: `Documents generate from v${t.versionNumber}.` }
}
