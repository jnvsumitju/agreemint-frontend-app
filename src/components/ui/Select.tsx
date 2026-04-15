import { forwardRef, type SelectHTMLAttributes } from 'react'

/* ── Props ── */

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  helper?: string
  error?: string
  size?: 'sm' | 'md' | 'lg'
  options: { value: string; label: string; disabled?: boolean }[]
  placeholder?: string
}

const sizeClasses = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-9 px-3 text-sm',
  lg: 'h-10 px-3.5 text-base',
}

/* ── Component ── */

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helper, error, size = 'md', options, placeholder, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={selectId}
            className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {label}
          </label>
        )}

        <select
          ref={ref}
          id={selectId}
          className={`w-full appearance-none rounded-lg border bg-white text-zinc-900 outline-none transition-colors
            focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20
            dark:bg-zinc-800 dark:text-zinc-100
            ${error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
              : 'border-zinc-300 dark:border-zinc-600'}
            ${sizeClasses[size]}
            pr-8
            bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')]
            bg-[length:16px] bg-[right_8px_center] bg-no-repeat
          `}
          aria-invalid={!!error}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>

        {error && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-500">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {error}
          </p>
        )}

        {helper && !error && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{helper}</p>
        )}
      </div>
    )
  },
)

Select.displayName = 'Select'
