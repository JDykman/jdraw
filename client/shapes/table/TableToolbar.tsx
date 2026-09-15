import { Editor, TldrawUiButton, track, useEditor } from 'tldraw'
import { TLTableShape } from '../../../shared/table/tableShapeProps'
import { activeTableCell } from './tableEditing'
import { deleteCol, deleteRow, insertCol, insertRow } from './tableOps'

/** The single selected table shape, or null. */
export function getSelectedTable(editor: Editor): TLTableShape | null {
	const shape = editor.getOnlySelectedShape()
	return shape && editor.isShapeOfType<TLTableShape>(shape, 'table') ? shape : null
}

type TableOp = 'row-add' | 'row-del' | 'col-add' | 'col-del' | 'header-toggle'

/**
 * Apply a structural op to the selected table. Inserts happen after the active
 * (edited) cell when there is one, else at the end; deletes target the active
 * row/col, else the last one.
 */
export function runTableOp(editor: Editor, op: TableOp) {
	const shape = getSelectedTable(editor)
	if (!shape) return
	const a = activeTableCell.get()
	const active = a && a.shapeId === shape.id ? a : null
	const rows = shape.props.rowHeights.length
	const cols = shape.props.colWidths.length
	const r = active ? active.row : rows - 1
	const c = active ? active.col : cols - 1

	let props = shape.props
	let nextActive = active
	switch (op) {
		case 'row-add':
			props = insertRow(props, r + 1)
			if (active) nextActive = { ...active, row: r + 1 }
			break
		case 'row-del':
			if (rows <= 1) return
			props = deleteRow(props, r)
			if (active) nextActive = { ...active, row: Math.min(r, rows - 2) }
			break
		case 'col-add':
			props = insertCol(props, c + 1)
			if (active) nextActive = { ...active, col: c + 1 }
			break
		case 'col-del':
			if (cols <= 1) return
			props = deleteCol(props, c)
			if (active) nextActive = { ...active, col: Math.min(c, cols - 2) }
			break
		case 'header-toggle':
			props = { ...props, headerRow: !props.headerRow }
			break
	}

	editor.markHistoryStoppingPoint(`table:${op}`)
	editor.updateShape({ id: shape.id, type: 'table', props })
	if (nextActive !== active) activeTableCell.set(nextActive)
}

const BUTTONS: { op: TableOp; label: string; title: string }[] = [
	{ op: 'row-add', label: '+ Row', title: 'Insert row below' },
	{ op: 'row-del', label: '− Row', title: 'Delete row' },
	{ op: 'col-add', label: '+ Col', title: 'Insert column right' },
	{ op: 'col-del', label: '− Col', title: 'Delete column' },
	{ op: 'header-toggle', label: 'Header', title: 'Toggle header row' },
]

/** Floating toolbar shown above a selected table. Mount via components.InFrontOfTheCanvas. */
export const TableToolbar = track(function TableToolbar() {
	const editor = useEditor()
	const shape = getSelectedTable(editor)
	if (!shape || editor.getInstanceState().isReadonly) return null
	if (editor.getCurrentToolId() !== 'select') return null
	const bounds = editor.getSelectionRotatedScreenBounds()
	if (!bounds) return null

	return (
		<div
			className="table-toolbar"
			style={{
				position: 'absolute',
				left: bounds.x,
				top: bounds.y - 44,
				pointerEvents: 'all',
			}}
			// Don't let the canvas see this click, and don't steal focus from a cell textarea.
			onPointerDown={(e) => {
				e.stopPropagation()
				e.preventDefault()
			}}
		>
			{BUTTONS.map((b) => (
				<TldrawUiButton
					key={b.op}
					type="normal"
					title={b.title}
					data-active={b.op === 'header-toggle' ? shape.props.headerRow : undefined}
					onClick={() => runTableOp(editor, b.op)}
				>
					{b.label}
				</TldrawUiButton>
			))}
		</div>
	)
})
