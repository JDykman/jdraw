import {
	TABLE_MIN_COL_WIDTH,
	TABLE_MIN_ROW_HEIGHT,
	TLTableShapeProps,
} from '../../../shared/table/tableShapeProps'

type Dims = Pick<TLTableShapeProps, 'w' | 'h' | 'colWidths' | 'rowHeights' | 'cells'>

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)

/**
 * Enforce invariants:
 *  - cells is rows x cols and matches rowHeights/colWidths lengths
 *  - every width/height >= min
 *  - w === sum(colWidths), h === sum(rowHeights)
 * Returns the same object if nothing changed.
 */
export function normalizeTable<P extends Dims>(props: P): P {
	let { colWidths, rowHeights, cells } = props
	const rows = Math.max(rowHeights.length, cells.length, 1)
	const cols = Math.max(colWidths.length, ...cells.map((r) => r.length), 1)

	let changed = false

	if (rowHeights.length !== rows) {
		rowHeights = Array.from({ length: rows }, (_, i) => rowHeights[i] ?? rowHeights.at(-1) ?? TABLE_MIN_ROW_HEIGHT)
		changed = true
	}
	if (colWidths.length !== cols) {
		colWidths = Array.from({ length: cols }, (_, i) => colWidths[i] ?? colWidths.at(-1) ?? TABLE_MIN_COL_WIDTH)
		changed = true
	}
	if (cells.length !== rows || cells.some((r) => r.length !== cols)) {
		cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells[r]?.[c] ?? ''))
		changed = true
	}

	if (colWidths.some((v) => v < TABLE_MIN_COL_WIDTH)) {
		colWidths = colWidths.map((v) => Math.max(TABLE_MIN_COL_WIDTH, v))
		changed = true
	}
	if (rowHeights.some((v) => v < TABLE_MIN_ROW_HEIGHT)) {
		rowHeights = rowHeights.map((v) => Math.max(TABLE_MIN_ROW_HEIGHT, v))
		changed = true
	}

	const w = sum(colWidths)
	const h = sum(rowHeights)
	if (Math.abs(w - props.w) > 0.01 || Math.abs(h - props.h) > 0.01) changed = true

	if (!changed) return props
	return { ...props, w, h, colWidths, rowHeights, cells }
}

/** Scale colWidths/rowHeights to exactly fill w/h (used after box resize). */
export function fitTableTo<P extends Dims>(props: P, w: number, h: number): P {
	const cw = sum(props.colWidths) || 1
	const rh = sum(props.rowHeights) || 1
	return normalizeTable({
		...props,
		colWidths: props.colWidths.map((v) => (v / cw) * w),
		rowHeights: props.rowHeights.map((v) => (v / rh) * h),
	})
}

export function insertRow<P extends Dims>(props: P, index: number): P {
	const rows = props.rowHeights.length
	const i = Math.max(0, Math.min(index, rows))
	const ref = props.rowHeights[Math.min(i, rows - 1)] ?? TABLE_MIN_ROW_HEIGHT
	const rowHeights = [...props.rowHeights]
	rowHeights.splice(i, 0, ref)
	const cells = props.cells.map((r) => [...r])
	cells.splice(i, 0, Array.from({ length: props.colWidths.length }, () => ''))
	return normalizeTable({ ...props, rowHeights, cells })
}

export function deleteRow<P extends Dims>(props: P, index: number): P {
	if (props.rowHeights.length <= 1) return props
	const i = Math.max(0, Math.min(index, props.rowHeights.length - 1))
	const rowHeights = props.rowHeights.filter((_, k) => k !== i)
	const cells = props.cells.filter((_, k) => k !== i).map((r) => [...r])
	return normalizeTable({ ...props, rowHeights, cells })
}

export function insertCol<P extends Dims>(props: P, index: number): P {
	const cols = props.colWidths.length
	const i = Math.max(0, Math.min(index, cols))
	const ref = props.colWidths[Math.min(i, cols - 1)] ?? TABLE_MIN_COL_WIDTH
	const colWidths = [...props.colWidths]
	colWidths.splice(i, 0, ref)
	const cells = props.cells.map((r) => {
		const row = [...r]
		row.splice(i, 0, '')
		return row
	})
	return normalizeTable({ ...props, colWidths, cells })
}

export function deleteCol<P extends Dims>(props: P, index: number): P {
	if (props.colWidths.length <= 1) return props
	const i = Math.max(0, Math.min(index, props.colWidths.length - 1))
	const colWidths = props.colWidths.filter((_, k) => k !== i)
	const cells = props.cells.map((r) => r.filter((_, k) => k !== i))
	return normalizeTable({ ...props, colWidths, cells })
}

export function setCell<P extends Dims>(props: P, row: number, col: number, text: string): P {
	if (props.cells[row]?.[col] === text) return props
	const cells = props.cells.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? text : c)) : r))
	return { ...props, cells }
}

/** Cumulative offsets: [0, w0, w0+w1, ...] (length n+1) */
export function cumulative(sizes: number[]): number[] {
	const out = [0]
	for (const s of sizes) out.push(out[out.length - 1] + s)
	return out
}

/** Which cell contains a shape-space point. Clamped to the grid. */
export function cellAtPoint(props: Dims, x: number, y: number): { row: number; col: number } {
	const cx = cumulative(props.colWidths)
	const cy = cumulative(props.rowHeights)
	let col = cx.findIndex((v, i) => i > 0 && x < v) - 1
	let row = cy.findIndex((v, i) => i > 0 && y < v) - 1
	if (col < 0) col = x < 0 ? 0 : props.colWidths.length - 1
	if (row < 0) row = y < 0 ? 0 : props.rowHeights.length - 1
	return { row, col }
}
