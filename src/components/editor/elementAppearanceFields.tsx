import { useState } from 'react'
import type { ElementShadow, ElementStyle, GradientDef } from '../../types/layout'
import { ColorToolbarSwatch } from './ColorPalettePopover'
import { INPUT_CLASS, MONO_INPUT_CLASS } from './uiClasses'

const inputClass = `min-w-0 flex-1 ${MONO_INPUT_CLASS}`
const numInputSmClass = `${INPUT_CLASS} min-w-0 flex-1`
const stepBtnClass =
  'rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-700'

function ColorRow({
  label,
  textInputId,
  value,
  onChange,
  onClear,
  gradient,
  onGradientChange,
}: {
  label: string
  /** Stable id/name for the hex/CSS text field (autofill / a11y). */
  textInputId: string
  value: string | undefined
  onChange: (next: string) => void
  onClear: () => void
  gradient?: GradientDef
  onGradientChange?: (g: GradientDef | undefined) => void
}) {
  const has = Boolean(value != null && String(value).trim() !== '') || gradient != null
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
          gradient={gradient}
          onGradientChange={onGradientChange}
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
          delete rest.colorGradient
          onChange(rest)
        }}
        gradient={s.colorGradient}
        onGradientChange={(g) => set({ colorGradient: g ?? undefined })}
      />
      <ColorRow
        label="Background"
        textInputId="ag-editor-richtext-bg-color"
        value={s.backgroundColor}
        onChange={(v) => set({ backgroundColor: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.backgroundColor
          delete rest.bgGradient
          onChange(rest)
        }}
        gradient={s.bgGradient}
        onGradientChange={(g) => set({ bgGradient: g ?? undefined })}
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
          delete rest.colorGradient
          onChange(rest)
        }}
        gradient={s.colorGradient}
        onGradientChange={(g) => onChange({ ...s, colorGradient: g ?? undefined })}
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
          delete rest.colorGradient
          onChange(rest)
        }}
        gradient={s.colorGradient}
        onGradientChange={(g) => onChange({ ...s, colorGradient: g ?? undefined })}
      />
      <ColorRow
        label="Fill"
        textInputId="ag-editor-box-fill-color"
        value={s.backgroundColor}
        onChange={(v) => onChange({ ...s, backgroundColor: v })}
        onClear={() => {
          const rest = { ...s }
          delete rest.backgroundColor
          delete rest.bgGradient
          onChange(rest)
        }}
        gradient={s.bgGradient}
        onGradientChange={(g) => onChange({ ...s, bgGradient: g ?? undefined })}
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

// ── Phase 2: advanced appearance controls ──

/** Opacity + rotation + drop-shadow — common to all element types. */
export function ElementVisualFields({
  style,
  onChange,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
}) {
  const s = style ?? {}
  const set = (patch: Partial<ElementStyle>) => onChange({ ...s, ...patch })

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-600">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Visual</p>

      {/* Opacity slider */}
      <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">
          Opacity: {Math.round((s.opacity ?? 1) * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((s.opacity ?? 1) * 100)}
          className="h-1.5 w-full cursor-pointer accent-violet-600"
          onChange={(e) => {
            const v = Number(e.target.value) / 100
            set({ opacity: v >= 1 ? undefined : Math.max(0, v) })
          }}
        />
      </label>

      {/* Rotation */}
      <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Rotation (deg)</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={stepBtnClass}
            title="Rotate −15°"
            onClick={() => set({ rotation: ((s.rotation ?? 0) - 15) % 360 })}
          >
            −15
          </button>
          <input
            type="number"
            className={numInputSmClass}
            value={s.rotation ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value) || 0
              set({ rotation: v === 0 ? undefined : v })
            }}
          />
          <button
            type="button"
            className={stepBtnClass}
            title="Rotate +15°"
            onClick={() => set({ rotation: ((s.rotation ?? 0) + 15) % 360 })}
          >
            +15
          </button>
        </div>
      </label>

      <ShadowSubfields style={s} onChange={onChange} />
    </div>
  )
}

/** Collapsible shadow controls. */
function ShadowSubfields({
  style,
  onChange,
}: {
  style: ElementStyle
  onChange: (s: ElementStyle) => void
}) {
  const shadow = style.shadow
  const [expanded, setExpanded] = useState(shadow != null)

  const updateShadow = (patch: Partial<ElementShadow>) => {
    const base = shadow ?? { offsetX: 2, offsetY: 2, blur: 4, color: 'rgba(0,0,0,0.25)' }
    onChange({ ...style, shadow: { ...base, ...patch } })
  }

  const clearShadow = () => {
    const rest = { ...style }
    delete rest.shadow
    onChange(rest)
    setExpanded(false)
  }

  return (
    <div className="flex flex-col gap-1 text-[10px] lg:text-xs">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          onClick={() => {
            if (!expanded) {
              if (!shadow) updateShadow({})
              setExpanded(true)
            } else {
              setExpanded(false)
            }
          }}
        >
          Shadow {expanded ? '▾' : '▸'}
        </button>
        {shadow && (
          <button
            type="button"
            className="text-[9px] text-red-500 hover:underline lg:text-[10px]"
            onClick={clearShadow}
          >
            Clear
          </button>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col gap-1.5 rounded border border-zinc-200 bg-white/60 p-1.5 dark:border-zinc-600 dark:bg-zinc-900/40">
          <div className="grid grid-cols-3 gap-1">
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">X</span>
              <input
                type="number"
                className={numInputSmClass}
                value={shadow?.offsetX ?? 2}
                onChange={(e) => updateShadow({ offsetX: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Y</span>
              <input
                type="number"
                className={numInputSmClass}
                value={shadow?.offsetY ?? 2}
                onChange={(e) => updateShadow({ offsetY: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Blur</span>
              <input
                type="number"
                min={0}
                className={numInputSmClass}
                value={shadow?.blur ?? 4}
                onChange={(e) => updateShadow({ blur: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
          </div>
          <ColorRow
            label="Shadow color"
            textInputId="ag-editor-shadow-color"
            value={shadow?.color ?? 'rgba(0,0,0,0.25)'}
            onChange={(v) => updateShadow({ color: v })}
            onClear={() => clearShadow()}
          />
        </div>
      )}
    </div>
  )
}

/** Border width, line style, border radius — for BOX, IMAGE, and shapes. */
export function BorderStyleFields({
  style,
  onChange,
  showBorderWidth,
  showBorderRadius,
  showLineStyle,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
  showBorderWidth?: boolean
  showBorderRadius?: boolean
  showLineStyle?: boolean
}) {
  const s = style ?? {}
  const set = (patch: Partial<ElementStyle>) => onChange({ ...s, ...patch })

  const anyVisible = showBorderWidth || showBorderRadius || showLineStyle
  if (!anyVisible) return null

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-600">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Border</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {showBorderWidth && (
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Width (pt)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              className={numInputSmClass}
              value={s.borderWidth ?? 2}
              onChange={(e) => set({ borderWidth: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        )}
        {showBorderRadius && (
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Radius (pt)</span>
            <input
              type="number"
              min={0}
              className={numInputSmClass}
              value={s.borderRadius ?? 0}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0)
                set({ borderRadius: v || undefined })
              }}
            />
          </label>
        )}
      </div>
      {showLineStyle && (
        <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
          <span className="font-medium text-zinc-600 dark:text-zinc-400">Line style</span>
          <select
            className={INPUT_CLASS}
            value={s.lineStyle ?? 'solid'}
            onChange={(e) => {
              const v = e.target.value as 'solid' | 'dashed' | 'dotted'
              set({ lineStyle: v === 'solid' ? undefined : v })
            }}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
      )}
    </div>
  )
}
