import { atom, TLShapeId } from 'tldraw'

export interface ActiveTableCell {
	shapeId: TLShapeId
	row: number
	col: number
}

/**
 * Which cell is being edited. Local UI state, not persisted, not synced.
 * The ShapeUtil sets it on double-click; the toolbar reads it to insert
 * rows/cols relative to the cursor.
 */
export const activeTableCell = atom<ActiveTableCell | null>('activeTableCell', null)

export interface TableSelection {
	shapeId: TLShapeId
	kind: 'row' | 'col'
	index: number
}

/** Whole row/column selected via the gutter tabs. Local UI state. */
export const tableSelection = atom<TableSelection | null>('tableSelection', null)
