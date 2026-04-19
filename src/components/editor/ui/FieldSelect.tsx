import type { ReactNode } from 'react'
import { LABEL_CLASS, INPUT_CLASS } from '../uiClasses'

interface FieldSelectProps {
  label: string
  id: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: { value: string; label: string }[]
  /**
   * Rendered inline next to the label — mirrors {@code FieldInput} so tiny
   * status glyphs (e.g. {@link BindingIndicator}) can sit alongside it.
   */
  labelAdornment?: ReactNode
}

export function FieldSelect({
  label,
  id,
  value,
  onChange,
  options,
  labelAdornment,
}: FieldSelectProps) {
  return (
    <label className={LABEL_CLASS}>
      <span className="flex items-center gap-1 font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {labelAdornment}
      </span>
      <select id={id} name={id} className={INPUT_CLASS} value={value} onChange={onChange}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
