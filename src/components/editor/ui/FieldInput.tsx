import type { ReactNode } from 'react'
import { LABEL_CLASS, INPUT_CLASS, MONO_INPUT_CLASS } from '../uiClasses'

interface FieldInputProps {
  label: string
  id: string
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur?: () => void
  type?: 'text' | 'number' | 'url'
  mono?: boolean
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
  /**
   * Rendered inline next to the label — intended for tiny status glyphs
   * (e.g. {@link BindingIndicator}). Kept optional so existing call sites
   * don't need to change.
   */
  labelAdornment?: ReactNode
}

export function FieldInput({
  label,
  id,
  value,
  onChange,
  onBlur,
  type = 'text',
  mono,
  min,
  max,
  step,
  placeholder,
  className,
  labelAdornment,
}: FieldInputProps) {
  return (
    <label className={className ?? LABEL_CLASS}>
      <span className="flex items-center gap-1 font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {labelAdornment}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        min={min}
        max={max}
        step={step}
        className={mono ? MONO_INPUT_CLASS : INPUT_CLASS}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={onBlur}
      />
    </label>
  )
}
