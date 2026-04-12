import type { TextRunFormatKey } from '../../lib/richContent'

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
      className={`min-w-[2rem] rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-violet-600 bg-violet-100 text-violet-900 dark:border-violet-500 dark:bg-violet-950/60 dark:text-violet-100'
          : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'
      }`}
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
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton label="Italic" active={italic} disabled={disabled} onMouseDown={fire('italic')}>
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={underline}
        disabled={disabled}
        onMouseDown={fire('underline')}
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={strikethrough}
        disabled={disabled}
        onMouseDown={fire('strikethrough')}
      >
        <span className="line-through">S</span>
      </ToolbarButton>
      <ToolbarButton
        label="Superscript"
        active={superscript}
        disabled={disabled}
        onMouseDown={fire('superscript')}
      >
        <span>
          x<sup className="text-[0.65em]">2</sup>
        </span>
      </ToolbarButton>
      <ToolbarButton
        label="Subscript"
        active={subscript}
        disabled={disabled}
        onMouseDown={fire('subscript')}
      >
        <span>
          x<sub className="text-[0.65em]">2</sub>
        </span>
      </ToolbarButton>
    </div>
  )
}
