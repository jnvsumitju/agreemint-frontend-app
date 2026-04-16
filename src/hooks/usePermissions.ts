import { useAuthStore } from '../stores/authStore'

const EDIT_ROLES = new Set(['DESIGNER', 'ADMIN'])
const COMMENT_ROLES = new Set(['REVIEWER', 'DESIGNER', 'ADMIN'])
const MANAGE_ROLES = new Set(['ADMIN'])

export interface Permissions {
  role: string | null
  isViewer: boolean
  isReviewer: boolean
  isDesigner: boolean
  isAdmin: boolean
  /** Can edit templates on canvas (DESIGNER, ADMIN) */
  canEdit: boolean
  /** Can comment on templates (REVIEWER, DESIGNER, ADMIN) */
  canComment: boolean
  /** Can create, clone, delete templates and install from marketplace (DESIGNER, ADMIN) */
  canCreateTemplates: boolean
  /** Can invite members, edit org settings, share templates (ADMIN) */
  canManageOrg: boolean
}

export function usePermissions(): Permissions {
  const org = useAuthStore((s) => s.org)
  const orgs = useAuthStore((s) => s.orgs)

  const entry = orgs.find((e) => e.org.id === org?.id)
  const role = entry?.role ?? null

  return {
    role,
    isViewer: role === 'VIEWER',
    isReviewer: role === 'REVIEWER',
    isDesigner: role === 'DESIGNER',
    isAdmin: role === 'ADMIN',
    canEdit: EDIT_ROLES.has(role ?? ''),
    canComment: COMMENT_ROLES.has(role ?? ''),
    canCreateTemplates: EDIT_ROLES.has(role ?? ''),
    canManageOrg: MANAGE_ROLES.has(role ?? ''),
  }
}
