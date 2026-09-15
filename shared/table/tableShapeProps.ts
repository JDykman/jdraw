import {
	createShapePropsMigrationSequence,
	DefaultColorStyle,
	DefaultFillStyle,
	DefaultFontStyle,
	DefaultSizeStyle,
	DefaultTextAlignStyle,
	RecordProps,
	RecordPropsType,
	TLBaseShape,
} from '@tldraw/tlschema'
import { T } from '@tldraw/validate'

/**
 * Shared between client (ShapeUtil) and server (sync schema).
 * Both sides MUST agree on props + migrations or the sync server rejects the records.
 */
export const tableShapeProps = {
	w: T.positiveNumber,
	h: T.positiveNumber,
	/** One entry per column; sum === w */
	colWidths: T.arrayOf(T.positiveNumber),
	/** One entry per row; sum === h */
	rowHeights: T.arrayOf(T.positiveNumber),
	/** cells[row][col] plain text */
	cells: T.arrayOf(T.arrayOf(T.string)),
	headerRow: T.boolean,
	color: DefaultColorStyle,
	fill: DefaultFillStyle,
	size: DefaultSizeStyle,
	font: DefaultFontStyle,
	textAlign: DefaultTextAlignStyle,
}

export type TLTableShapeProps = RecordPropsType<typeof tableShapeProps>
export type TLTableShape = TLBaseShape<'table', TLTableShapeProps>

// Register the shape type globally so TLShape / editor generics accept 'table'.
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		table: TLTableShapeProps
	}
}

// Bump this + add a migration whenever props change shape.
export const tableShapeMigrations = createShapePropsMigrationSequence({
	sequence: [],
})

export const tableShapeSchema = {
	props: tableShapeProps as RecordProps<TLTableShape>,
	migrations: tableShapeMigrations,
}

export const TABLE_MIN_COL_WIDTH = 24
export const TABLE_MIN_ROW_HEIGHT = 20
export const TABLE_DEFAULT_COL_WIDTH = 120
export const TABLE_DEFAULT_ROW_HEIGHT = 40
