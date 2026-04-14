import { BUTTON_CLASS, BUTTON_HIGHLIGHT_CLASS, BUTTON_DANGER_CLASS } from '../uiClasses'

const variantClass = {
  default: BUTTON_CLASS,
  highlight: BUTTON_HIGHLIGHT_CLASS,
  danger: BUTTON_DANGER_CLASS,
} as const

interface ActionButtonProps {
  children: React.ReactNode
  onClick: () => void
  variant?: keyof typeof variantClass
  disabled?: boolean
  title?: string
  className?: string
}

export function ActionButton({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
  className,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      className={`${variantClass[variant]}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
