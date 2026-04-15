import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/Button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>

          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Something went wrong
          </h2>
          <p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
            An unexpected error occurred. You can try again or reload the page.
          </p>

          {this.state.error && (
            <pre className="mt-3 max-w-md overflow-auto rounded-lg bg-zinc-100 px-4 py-2 text-left text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {this.state.error.message}
            </pre>
          )}

          <div className="mt-5 flex gap-3">
            <Button variant="primary" size="sm" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button variant="secondary" size="sm" onClick={this.handleReload}>
              Reload Page
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
