/**
 * Centralized toolbar icon components.
 * All icons: viewBox 0 0 24 24, stroke-based, consistent 2px stroke,
 * round caps/joins, aria-hidden. Inspired by Lucide / Feather icon style.
 */

type IconProps = { size?: number; className?: string }

const defaults = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  className,
})

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

export function IconUndo({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  )
}

export function IconRedo({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Text Formatting                                                    */
/* ------------------------------------------------------------------ */

export function IconBold({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  )
}

export function IconItalic({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  )
}

export function IconUnderline({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </svg>
  )
}

export function IconStrikethrough({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M16 4c-.5-1.5-2.2-3-5-3-3 0-5 2-5 4.5 0 2 1.5 3.5 5 4.5" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M18 14c0 3-2 5-5 5s-5-1.5-5-4" />
    </svg>
  )
}

export function IconSuperscript({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M4 19l8-8" />
      <path d="M12 19l-8-8" />
      <path d="M20 9h-4c0-1.5.4-2.5 1.2-3.2C18 5 19 4.5 19 3.5 19 2.7 18.3 2 17.5 2S16 2.7 16 3.5" />
    </svg>
  )
}

export function IconSubscript({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M4 5l8 8" />
      <path d="M12 5l-8 8" />
      <path d="M20 19h-4c0-1.5.4-2.5 1.2-3.2C18 15 19 14.5 19 13.5c0-.8-.7-1.5-1.5-1.5S16 12.7 16 13.5" />
    </svg>
  )
}

export function IconClearFormat({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v7" />
      <path d="M2 17l5 5" />
      <path d="M7 17l-5 5" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Alignment                                                          */
/* ------------------------------------------------------------------ */

export function IconAlignLeft({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M3 6h18M3 12h12M3 18h16" />
    </svg>
  )
}

export function IconAlignCenter({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M3 6h18M6 12h12M4 18h16" />
    </svg>
  )
}

export function IconAlignRight({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M3 6h18M9 12h12M5 18h16" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Steppers / Dropdown                                                */
/* ------------------------------------------------------------------ */

export function IconMinus({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconChevronDown({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Color                                                              */
/* ------------------------------------------------------------------ */

/** Circle with diagonal red strike — represents "no color / transparent". */
export function IconNoColor({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Paint bucket — represents fill color. */
export function IconPaintBucket({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M2.5 18.5l9-9 5 5-9 9z" />
      <path d="M7.5 13.5l-3-3 9-9 3 3" />
      <path d="M19 15c1 1 2 2.5 2 4 0 1.5-1 2-2 2s-2-.5-2-2c0-1.5 1-3 2-4z" />
    </svg>
  )
}

/** Pen tip — represents stroke/border color. */
export function IconBorderColor({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Navigation / Actions                                               */
/* ------------------------------------------------------------------ */

export function IconEye({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IconSave({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

export function IconSun({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

export function IconMoon({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export function IconMonitor({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

export function IconMoreVertical({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  )
}

export function IconScissors({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" strokeDasharray="2 1" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Zoom                                                               */
/* ------------------------------------------------------------------ */

export function IconZoomIn({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  )
}

export function IconZoomOut({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  )
}

export function IconTrash({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function IconColumns({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M15 3v18" />
    </svg>
  )
}

export function IconRows({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18" />
    </svg>
  )
}

export function IconArrowUp({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

export function IconArrowDown({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}

export function IconArrowLeft({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function IconArrowRight({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <svg {...defaults(size, className)}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}
