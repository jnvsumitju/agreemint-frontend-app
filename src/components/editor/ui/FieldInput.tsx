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
}: FieldInputProps) {
  return (
    <label className={className ?? LABEL_CLASS}>
      <span className="font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
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
