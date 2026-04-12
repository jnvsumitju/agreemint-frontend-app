import type { ElementStyle } from '../../types/layout'
import { ColorToolbarSwatch } from './ColorPalettePopover'

const inputClass =
  'min-w-0 flex-1 rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-[10px] lg:px-2 lg:py-1 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800'

function ColorRow({
  label,
  textInputId,
  value,
  onChange,
  onClear,
}: {
  label: string
  /** Stable id/name for the hex/CSS text field (autofill / a11y). */
  textInputId: string
  value: string | undefined
  onChange: (next: string) => void
  onClear: () => void
}) {
  const has = Boolean(value != null && String(value).trim() !== '')
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <ColorToolbarSwatch
          size="md"
          title={label}
          value={value}
          onChange={onChange}
          onClear={has ? onClear : undefined}
        />
        <input
          type="text"
          className={inputClass}
          value={value ?? ''}
          placeholder="#1e293b, rgb(0,0,0)…"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

/** Typography colors for TEXT / HEADER / FOOTER. */
export function RichTextAppearanceFields({
  style,
  onChange,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
}) {
  const s = style ?? {}
  const set = (patch: Partial<ElementStyle>) => {
    const next = { ...s, ...patch }
    if (next.color !== undefined && String(next.color).trim() === '') delete next.color
    if (next.backgroundColor !== undefined && String(next.backgroundColor).trim() === '')
      delete next.backgroundColor
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-600">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Color</p>
      <ColorRow
        label="Text"
        textInputId="ag-editor-richtext-text-color"
        value={s.color}
        onChange={(v) => set({ color: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.color
          onChange(rest)
        }}
      />
      <ColorRow
        label="Background"
        textInputId="ag-editor-richtext-bg-color"
        value={s.backgroundColor}
        onChange={(v) => set({ backgroundColor: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.backgroundColor
          onChange(rest)
        }}
      />
    </div>
  )
}

/** Single stroke / border color (LINE, or shared `style.color`). */
export function StrokeColorField({
  style,
  onChange,
  label = 'Stroke color',
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
  label?: string
}) {
  const s = style ?? {}
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-600">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Color</p>
      <ColorRow
        label={label}
        textInputId="ag-editor-stroke-color"
        value={s.color}
        onChange={(v) => onChange({ ...s, color: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.color
          onChange(rest)
        }}
      />
    </div>
  )
}

/** Border + fill for BOX (and similar). */
export function BoxAppearanceFields({
  style,
  onChange,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
}) {
  const s = style ?? {}
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-600">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Color</p>
      <ColorRow
        label="Border"
        textInputId="ag-editor-box-border-color"
        value={s.color}
        onChange={(v) => onChange({ ...s, color: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.color
          onChange(rest)
        }}
      />
      <ColorRow
        label="Fill"
        textInputId="ag-editor-box-fill-color"
        value={s.backgroundColor}
        onChange={(v) => onChange({ ...s, backgroundColor: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.backgroundColor
          onChange(rest)
        }}
      />
    </div>
  )
}

/** Default text color for table header + body preview. */
export function TableTextColorField({
  style,
  onChange,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
}) {
  const s = style ?? {}
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Text color</p>
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
        Applies to header rich text and data cells in the canvas preview.
      </p>
      <ColorRow
        label="Cell text"
        textInputId="ag-editor-table-text-color"
        value={s.color}
        onChange={(v) => onChange({ ...s, color: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.color
          onChange(rest)
        }}
      />
    </div>
  )
}
