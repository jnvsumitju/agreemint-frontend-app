interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}

const sizes = {
  sm: { track: 'h-4 w-7', thumb: 'h-3 w-3', translate: 'translate-x-3' },
  md: { track: 'h-5 w-9', thumb: 'h-4 w-4', translate: 'translate-x-4' },
}

export function ToggleSwitch({ checked, onChange, label, size = 'sm', disabled }: ToggleSwitchProps) {
  const s = sizes[size]

  return (
    <label className={`inline-flex items-center gap-1.5 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex shrink-0 rounded-full transition-colors duration-200 ease-in-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1
          ${s.track}
          ${checked
            ? 'bg-violet-600'
            : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
      >
        <span
          className={`inline-block rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out
            ${s.thumb}
            ${checked ? s.translate : 'translate-x-0.5'}
            mt-0.5`}
        />
      </button>
      {label && (
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      )}
    </label>
  )
}
