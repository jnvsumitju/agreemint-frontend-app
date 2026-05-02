import type { ElementType } from '../../types/layout'

export const DND_NEW = 'DND_NEW_ELEMENT'
export const DND_MOVE = 'DND_MOVE_ELEMENT'
export const DND_COMPONENT = 'DND_LAYOUT_COMPONENT'
export const DND_PAGE_REORDER = 'DND_PAGE_REORDER'

export type PageReorderDragItem = { type: typeof DND_PAGE_REORDER; fromIndex: number }

export type NewElementDragItem = { type: typeof DND_NEW; elementType: ElementType }

export type LayoutComponentDragItem = { type: typeof DND_COMPONENT; componentId: string }

export type MoveElementDragItem = {
  type: typeof DND_MOVE
  id: string
  startX: number
  startY: number
}

export type CanvasDragItem = NewElementDragItem | MoveElementDragItem | LayoutComponentDragItem
