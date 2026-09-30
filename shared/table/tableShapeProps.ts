import {
	createShapePropsMigrationIds,
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
	/** Stable per-row / per-column ids; survive insert, delete and reorder. Used to keep arrows attached. */
	rowIds: T.arrayOf(T.string),
	colIds: T.arrayOf(T.string),
	/** One entry per column; sum === w */
	colWidths: T.arrayOf(T.positiveNumber),
	/** One entry per row; sum === h */
	rowHeights: T.arrayOf(T.positiveNumber),
	/** cells[row][col] plain text */
	cells: T.arrayOf(T.arrayOf(T.string)),
	headerRow: T.boolean,
	/** Caption drawn in a band above the grid when showTitle is true. */
	title: T.string,
	showTitle: T.boolean,
	/** Per-column alignment override; null = use the table's textAlign. Length === colWidths.length */
	colAlign: T.arrayOf(T.literalEnum('start', 'middle', 'end').nullable()),
	/** Per-column monospace flag. Length === colWidths.length */
	colMono: T.arrayOf(T.boolean),
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

// Add an id + migration whenever props change shape. Both client and server pick this up.
export const tableShapeVersions = createShapePropsMigrationIds('table', {
	AddTitle: 1,
	AddColumnStyles: 2,
	AddRowColIds: 3,
})

export const tableShapeMigrations = createShapePropsMigrationSequence({
	sequence: [
		{
			id: tableShapeVersions.AddTitle,
			up: (props) => {
				props.title = ''
				props.showTitle = false
			},
			down: (props) => {
				delete props.title
				delete props.showTitle
			},
		},
		{
			id: tableShapeVersions.AddColumnStyles,
			up: (props) => {
				const n = Array.isArray(props.colWidths) ? props.colWidths.length : 0
				props.colAlign = Array(n).fill(null)
				props.colMono = Array(n).fill(false)
			},
			down: (props) => {
				delete props.colAlign
				delete props.colMono
			},
		},
		{
			id: tableShapeVersions.AddRowColIds,
			// Deterministic so server- and client-side migrations of the same record agree.
			up: (props) => {
				const rows = Array.isArray(props.rowHeights) ? props.rowHeights.length : 0
				const cols = Array.isArray(props.colWidths) ? props.colWidths.length : 0
				props.rowIds = Array.from({ length: rows }, (_, i) => `r${i}`)
				props.colIds = Array.from({ length: cols }, (_, i) => `c${i}`)
			},
			down: (props) => {
				delete props.rowIds
				delete props.colIds
			},
		},
	],
})

export const tableShapeSchema = {
	props: tableShapeProps as RecordProps<TLTableShape>,
	migrations: tableShapeMigrations,
}

export const TABLE_MIN_COL_WIDTH = 24
export const TABLE_MIN_ROW_HEIGHT = 20
export const TABLE_DEFAULT_COL_WIDTH = 120
export const TABLE_DEFAULT_ROW_HEIGHT = 40
export const TABLE_TITLE_HEIGHT = 36
