import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/ui'

/**
 * Catch-all 404. Rendered inside AppLayout so the nav bar stays available —
 * a mistyped URL should look like a wrong turn, not a broken app.
 */
export function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="page-enter mx-auto max-w-5xl px-4 py-8">
      <EmptyState
        icon={
          <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
            />
          </svg>
        }
        title="This page doesn't exist"
        description="The link may be broken, or the page may have been moved or renamed."
        action={{ label: 'Go to Dashboard', onClick: () => navigate('/dashboard') }}
        secondaryAction={{ label: 'Browse templates', onClick: () => navigate('/templates') }}
      />
    </div>
  )
}
