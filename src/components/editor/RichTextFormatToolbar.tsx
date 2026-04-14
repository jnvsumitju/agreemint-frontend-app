import type { TextRunFormatKey } from '../../lib/richContent'
import { IconBold, IconItalic, IconUnderline, IconStrikethrough, IconSuperscript, IconSubscript } from './ToolbarIcons'
import { TOOLBAR_ICON_BTN, TOOLBAR_ICON_BTN_ACTIVE } from './uiClasses'

export interface RichTextFormatToolbarProps {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  superscript: boolean
  subscript: boolean
  disabled?: boolean
  onToggle: (key: TextRunFormatKey) => void
}

function ToolbarButton({
  active,
  disabled,
  label,
  onMouseDown,
  children,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onMouseDown: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={active ? TOOLBAR_ICON_BTN_ACTIVE : TOOLBAR_ICON_BTN}
      onMouseDown={onMouseDown}
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

/** Bold, italic, underline, strikethrough, sub/sup — toggles for the active text run (Properties). */
export function RichTextFormatToolbar({
  bold,
  italic,
  underline,
  strikethrough,
  superscript,
  subscript,
  disabled,
  onToggle,
}: RichTextFormatToolbarProps) {
  const fire = (key: TextRunFormatKey) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (!disabled) onToggle(key)
  }

  return (
    <div
      className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800/80"
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Text formatting"
    >
      <ToolbarButton label="Bold" active={bold} disabled={disabled} onMouseDown={fire('bold')}>
        <IconBold size={14} />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={italic} disabled={disabled} onMouseDown={fire('italic')}>
        <IconItalic size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={underline}
        disabled={disabled}
        onMouseDown={fire('underline')}
      >
        <IconUnderline size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={strikethrough}
        disabled={disabled}
        onMouseDown={fire('strikethrough')}
      >
        <IconStrikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Superscript"
        active={superscript}
        disabled={disabled}
        onMouseDown={fire('superscript')}
      >
        <IconSuperscript size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Subscript"
        active={subscript}
        disabled={disabled}
        onMouseDown={fire('subscript')}
      >
        <IconSubscript size={14} />
      </ToolbarButton>
    </div>
  )
}
