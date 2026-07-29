import { useNavigate } from 'react-router-dom'
import { Button } from '../ui'
import { usePermissions } from '../../hooks/usePermissions'

/**
 * Shown in place of a paid feature on the Free plan.
 *
 * Deliberately explains what the feature does rather than just blocking — a
 * dead control teaches nothing, and this is the moment someone is most likely
 * to care about upgrading.
 *
 * Only admins can actually reach billing, so non-admins are told who to ask
 * instead of being sent to a page they cannot use.
 */
export function UpgradePrompt({
  feature,
  description,
  compact = false,
}: {
  feature: string
  description: string
  compact?: boolean
}) {
  const navigate = useNavigate()
  const { isAdmin } = usePermissions()

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-900 dark:bg-violet-950/40">
        <span className="text-violet-900 dark:text-violet-200">
          <span className="font-medium">{feature}</span> is a Pro feature.
        </span>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => navigate('/settings?tab=billing')}
            className="font-medium text-violet-700 underline underline-offset-2 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
          >
            Upgrade
          </button>
        ) : (
          <span className="text-violet-700 dark:text-violet-300">Ask an admin to upgrade.</span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 dark:border-violet-900 dark:bg-violet-950/40">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600">
          <svg
            className="h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
            />
          </svg>
        </div>

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-100">
            {feature} is available on Pro
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-violet-800 dark:text-violet-200">
            {description}
          </p>

          <div className="mt-3">
            {isAdmin ? (
              <Button size="sm" onClick={() => navigate('/settings?tab=billing')}>
                Upgrade to Pro
              </Button>
            ) : (
              <p className="text-sm text-violet-700 dark:text-violet-300">
                Ask a workspace admin to upgrade.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
