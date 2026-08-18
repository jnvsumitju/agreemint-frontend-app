import type { TemplateDto } from './api'

export type TemplateStatusTone = 'warning' | 'success' | 'info'

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
export function templateStatus(t: Pick<TemplateDto, 'versionNumber' | 'hasUncommittedChanges'>): TemplateStatus {
  if (t.versionNumber == null) {
    return {
      label: 'Draft',
      tone: 'warning',
      title: 'Never committed — commit a version before generating documents from this template.',
    }
  }
  if (t.hasUncommittedChanges) {
    return {
      label: `v${t.versionNumber} · edited`,
      tone: 'info',
      title:
        `Editor changes are not in v${t.versionNumber}. Documents still generate from v${t.versionNumber} ` +
        'until you commit.',
    }
  }
  return {
    label: `v${t.versionNumber}`,
    tone: 'success',
    title: `Committed. Documents generate from v${t.versionNumber}.`,
  }
}
