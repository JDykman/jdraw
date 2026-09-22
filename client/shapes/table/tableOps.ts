import {
	TABLE_MIN_COL_WIDTH,
	TABLE_MIN_ROW_HEIGHT,
	TABLE_TITLE_HEIGHT,
	TLTableShapeProps,
} from '../../../shared/table/tableShapeProps'

type Dims = Pick<TLTableShapeProps, 'w' | 'h' | 'colWidths' | 'rowHeights' | 'cells' | 'showTitle'>

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)

/** Height of the title band above the grid (0 when hidden). */
export function titleHeight(props: Pick<Dims, 'showTitle'>): number {
	return props.showTitle ? TABLE_TITLE_HEIGHT : 0
}

/**
 * Enforce invariants:
 *  - cells is rows x cols and matches rowHeights/colWidths lengths
 *  - every width/height >= min
 *  - w === sum(colWidths), h === titleHeight + sum(rowHeights)
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
	const h = titleHeight(props) + sum(rowHeights)
	if (Math.abs(w - props.w) > 0.01 || Math.abs(h - props.h) > 0.01) changed = true

	if (!changed) return props
	return { ...props, w, h, colWidths, rowHeights, cells }
}

/** Scale colWidths/rowHeights to exactly fill w/h (used after box resize). h is the total shape height incl. title. */
export function fitTableTo<P extends Dims>(props: P, w: number, h: number): P {
	const cw = sum(props.colWidths) || 1
	const rh = sum(props.rowHeights) || 1
	const gridH = Math.max(h - titleHeight(props), props.rowHeights.length * TABLE_MIN_ROW_HEIGHT)
	return normalizeTable({
		...props,
		colWidths: props.colWidths.map((v) => (v / cw) * w),
		rowHeights: props.rowHeights.map((v) => (v / rh) * gridH),
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

/** Fill a block of cells starting at (row, col), growing the table as needed. */
export function fillCells<P extends Dims>(props: P, row: number, col: number, grid: string[][]): P {
	let next: P = props
	const needRows = row + grid.length
	const needCols = col + Math.max(0, ...grid.map((r) => r.length))
	while (next.rowHeights.length < needRows) next = insertRow(next, next.rowHeights.length)
	while (next.colWidths.length < needCols) next = insertCol(next, next.colWidths.length)
	const cells = next.cells.map((r) => [...r])
	grid.forEach((gr, ri) => gr.forEach((v, ci) => (cells[row + ri][col + ci] = v)))
	return { ...next, cells }
}

/**
 * Parse tab- or comma-separated text into a grid. Returns null unless it looks like
 * tabular data: >= 2 rows and a consistent column count >= 2 (or a single tab-delimited row).
 */
export function parseDelimited(text: string): string[][] | null {
	const raw = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
	if (!raw) return null
	const lines = raw.split('\n')
	const delim = raw.includes('\t') ? '\t' : raw.includes(',') ? ',' : null
	if (!delim) return null
	const rows = lines.map((l) => (delim === '\t' ? l.split('\t') : splitCsvLine(l)))
	const cols = rows[0].length
	if (cols < 2) return null
	if (rows.length < 2 && delim !== '\t') return null
	if (rows.some((r) => r.length !== cols)) return null
	return rows.map((r) => r.map((c) => c.trim()))
}

function splitCsvLine(line: string): string[] {
	const out: string[] = []
	let cur = ''
	let q = false
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		if (q) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"'
				i++
			} else if (ch === '"') q = false
			else cur += ch
		} else if (ch === '"') q = true
		else if (ch === ',') {
			out.push(cur)
			cur = ''
		} else cur += ch
	}
	out.push(cur)
	return out
}

export function toMarkdown(props: Pick<Dims, 'cells'> & { headerRow: boolean }): string {
	const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
	const rows = props.cells.map((r) => `| ${r.map(esc).join(' | ')} |`)
	const cols = props.cells[0]?.length ?? 0
	const sep = `| ${Array(cols).fill('---').join(' | ')} |`
	if (props.headerRow && rows.length) return [rows[0], sep, ...rows.slice(1)].join('\n')
	return [`| ${Array(cols).fill(' ').join(' | ')} |`, sep, ...rows].join('\n')
}

export function toCsv(props: Pick<Dims, 'cells'>): string {
	const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
	return props.cells.map((r) => r.map(esc).join(',')).join('\n')
}

/** Which cell contains a shape-space point. Clamped to the grid. row === -1 means the title band. */
export function cellAtPoint(props: Dims, x: number, y: number): { row: number; col: number } {
	const th = titleHeight(props)
	if (th > 0 && y < th) return { row: -1, col: 0 }
	y -= th
	const cx = cumulative(props.colWidths)
	const cy = cumulative(props.rowHeights)
	let col = cx.findIndex((v, i) => i > 0 && x < v) - 1
	let row = cy.findIndex((v, i) => i > 0 && y < v) - 1
	if (col < 0) col = x < 0 ? 0 : props.colWidths.length - 1
	if (row < 0) row = y < 0 ? 0 : props.rowHeights.length - 1
	return { row, col }
}
