import { CHECKBOX_LABEL_CLASS } from '../uiClasses'

interface FieldCheckboxProps {
  label: string
  id: string
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function FieldCheckbox({ label, id, checked, onChange }: FieldCheckboxProps) {
  return (
    <label className={CHECKBOX_LABEL_CLASS}>
      <input id={id} name={id} type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  )
}
