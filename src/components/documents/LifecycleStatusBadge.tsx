import { Badge } from '../ui/Badge'
import type { LifecycleStatus } from '../../lib/api'

const statusConfig: Record<LifecycleStatus, { variant: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'; dot: boolean; label: string }> = {
  DRAFT: { variant: 'default', dot: false, label: 'Draft' },
  PENDING_REVIEW: { variant: 'warning', dot: true, label: 'Pending Review' },
  APPROVED: { variant: 'success', dot: true, label: 'Approved' },
  REJECTED: { variant: 'danger', dot: true, label: 'Rejected' },
  SENT: { variant: 'info', dot: false, label: 'Sent' },
  SIGNED: { variant: 'primary', dot: false, label: 'Signed' },
  ACTIVE: { variant: 'success', dot: false, label: 'Active' },
  EXPIRED: { variant: 'warning', dot: false, label: 'Expired' },
  ARCHIVED: { variant: 'default', dot: false, label: 'Archived' },
}

export function LifecycleStatusBadge({ status, size = 'md' }: { status: LifecycleStatus; size?: 'sm' | 'md' | 'lg' }) {
  const config = statusConfig[status] ?? statusConfig.DRAFT
  return (
    <Badge variant={config.variant} dot={config.dot} size={size}>
      {config.label}
    </Badge>
  )
}
