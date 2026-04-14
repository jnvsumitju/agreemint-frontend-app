import { LABEL_CLASS, INPUT_CLASS } from '../uiClasses'

interface FieldSelectProps {
  label: string
  id: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: { value: string; label: string }[]
}

export function FieldSelect({ label, id, value, onChange, options }: FieldSelectProps) {
  return (
    <label className={LABEL_CLASS}>
      <span className="font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
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
