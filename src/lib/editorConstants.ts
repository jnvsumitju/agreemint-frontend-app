import type { ElementType } from '../types/layout'

/** Default font size for new text elements. */
export const DEFAULT_FONT_SIZE = 12

/** Min/max font size for the size stepper in the context toolbar. */
export const FONT_SIZE_MIN = 6
export const FONT_SIZE_MAX = 96

/** Canvas zoom limits and step multiplier. */
export const CANVAS_ZOOM_MIN = 0.25
export const CANVAS_ZOOM_MAX = 3
export const CANVAS_ZOOM_STEP = 1.15

/** Table canvas: min header row height in CSS grid. */
export const TABLE_HEADER_MIN_HEIGHT = 20
/** Table canvas: min body row height in CSS grid. */
export const TABLE_BODY_ROW_MIN_HEIGHT = 10
/** Table canvas: row gutter strip width in px. */
export const TABLE_GUTTER_WIDTH = 20
/** Table canvas: column letter band height in px. */
export const TABLE_LETTER_BAND_HEIGHT = 14

/** Default canvas dimensions (width, height) for each element type. */
export const DEFAULT_ELEMENT_DIMENSIONS: Record<ElementType, { width: number; height: number }> = {
  TEXT: { width: 400, height: 80 },
  HEADER: { width: 500, height: 32 },
  FOOTER: { width: 500, height: 32 },
  TABLE: { width: 200, height: 88 },
  IMAGE: { width: 120, height: 120 },
  LINE: { width: 400, height: 4 },
  BOX: { width: 160, height: 80 },
  ELLIPSE: { width: 120, height: 80 },
  TRIANGLE: { width: 100, height: 100 },
  ARROW: { width: 200, height: 40 },
  DIAMOND: { width: 100, height: 100 },
  STAR: { width: 100, height: 100 },
  RING: { width: 100, height: 100 },
  MERGED_SHAPE: { width: 100, height: 100 },
  LIST: { width: 300, height: 120 },
}

/** Default stroke/fill colors for shape elements. */
export const DEFAULT_SHAPE_COLORS: Partial<Record<ElementType, string>> = {
  LINE: '#64748b',
  BOX: '#64748b',
  ELLIPSE: '#6366f1',
  TRIANGLE: '#0ea5e9',
  ARROW: '#7c3aed',
  DIAMOND: '#db2777',
  STAR: '#ca8a04',
  RING: '#0f766e',
}

/** Default text color for new text/header/footer elements. */
export const DEFAULT_TEXT_COLOR = '#374151'
