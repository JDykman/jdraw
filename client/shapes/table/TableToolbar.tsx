import { Editor, TldrawUiButton, track, useEditor } from 'tldraw'
import { TLTableShape } from '../../../shared/table/tableShapeProps'
import { activeTableCell, tableSelection } from './tableEditing'
import { deleteCol, deleteRow, insertCol, insertRow, toCsv, toMarkdown } from '../../../shared/table/tableOps'

/** The single selected table shape, or null. */
export function getSelectedTable(editor: Editor): TLTableShape | null {
	const shape = editor.getOnlySelectedShape()
	return shape && editor.isShapeOfType<TLTableShape>(shape, 'table') ? shape : null
}

type TableOp =
	| 'row-add'
	| 'row-del'
	| 'col-add'
	| 'col-del'
	| 'header-toggle'
	| 'title-toggle'
	| 'align-start'
	| 'align-middle'
	| 'align-end'
	| 'align-auto'
	| 'mono-toggle'
	| 'delete-selected'

/**
 * Apply a structural op to the selected table. Target row/col priority:
 * gutter selection > active (edited) cell > last row/col.
 */
export function runTableOp(editor: Editor, op: TableOp) {
	const shape = getSelectedTable(editor)
	if (!shape) return
	const a = activeTableCell.get()
	const active = a && a.shapeId === shape.id ? a : null
	const selRaw = tableSelection.get()
	const sel = selRaw && selRaw.shapeId === shape.id ? selRaw : null
	const rows = shape.props.rowHeights.length
	const cols = shape.props.colWidths.length
	const r = sel?.kind === 'row' ? sel.index : active && active.row >= 0 ? active.row : rows - 1
	const c = sel?.kind === 'col' ? sel.index : active ? active.col : cols - 1
	let nextSel = sel

	if (op === 'delete-selected') {
		if (!sel) return
		op = sel.kind === 'row' ? 'row-del' : 'col-del'
	}

	let props = shape.props
	let nextActive = active
	switch (op) {
		case 'row-add':
			props = insertRow(props, r + 1)
			if (active) nextActive = { ...active, row: r + 1 }
			if (sel?.kind === 'row') nextSel = { ...sel, index: r + 1 }
			break
		case 'row-del':
			if (rows <= 1) return
			props = deleteRow(props, r)
			if (active) nextActive = { ...active, row: Math.min(r, rows - 2) }
			if (sel?.kind === 'row') nextSel = { ...sel, index: Math.min(r, rows - 2) }
			break
		case 'col-add':
			props = insertCol(props, c + 1)
			if (active) nextActive = { ...active, col: c + 1 }
			if (sel?.kind === 'col') nextSel = { ...sel, index: c + 1 }
			break
		case 'col-del':
			if (cols <= 1) return
			props = deleteCol(props, c)
			if (active) nextActive = { ...active, col: Math.min(c, cols - 2) }
			if (sel?.kind === 'col') nextSel = { ...sel, index: Math.min(c, cols - 2) }
			break
		case 'align-start':
		case 'align-middle':
		case 'align-end':
		case 'align-auto': {
			const colAlign = [...props.colAlign]
			colAlign[c] = op === 'align-auto' ? null : (op.slice(6) as 'start' | 'middle' | 'end')
			props = { ...props, colAlign }
			break
		}
		case 'mono-toggle': {
			const colMono = [...props.colMono]
			colMono[c] = !colMono[c]
			props = { ...props, colMono }
			break
		}
		case 'header-toggle':
			props = { ...props, headerRow: !props.headerRow }
			break
		case 'title-toggle':
			props = { ...props, showTitle: !props.showTitle }
			if (props.showTitle && active) nextActive = { ...active, row: -1, col: 0 }
			else if (!props.showTitle && active?.row === -1) nextActive = { ...active, row: 0 }
			break
	}

	editor.markHistoryStoppingPoint(`table:${op}`)
	editor.updateShape({ id: shape.id, type: 'table', props })
	if (nextActive !== active) activeTableCell.set(nextActive)
	if (nextSel !== sel) tableSelection.set(nextSel)
}

/** True when a table row/column is selected via the gutter; used to redirect the Delete action. */
export function hasTableSelection(editor: Editor): boolean {
	const shape = getSelectedTable(editor)
	const sel = tableSelection.get()
	return !!shape && !!sel && sel.shapeId === shape.id
}

const BUTTONS: { op: TableOp; label: string; title: string }[] = [
	{ op: 'row-add', label: '+ Row', title: 'Insert row below' },
	{ op: 'row-del', label: '− Row', title: 'Delete row' },
	{ op: 'col-add', label: '+ Col', title: 'Insert column right' },
	{ op: 'col-del', label: '− Col', title: 'Delete column' },
	{ op: 'header-toggle', label: 'Header', title: 'Toggle header row' },
	{ op: 'title-toggle', label: 'Title', title: 'Toggle table title' },
]

const COL_BUTTONS: { op: TableOp; label: string; title: string }[] = [
	{ op: 'align-start', label: '⇤', title: 'Align column left' },
	{ op: 'align-middle', label: '↔', title: 'Align column center' },
	{ op: 'align-end', label: '⇥', title: 'Align column right' },
	{ op: 'mono-toggle', label: 'Mono', title: 'Monospace column' },
]

export async function copyTableAs(editor: Editor, format: 'markdown' | 'csv') {
	const shape = getSelectedTable(editor)
	if (!shape) return
	const text = format === 'markdown' ? toMarkdown(shape.props) : toCsv(shape.props)
	try {
		await navigator.clipboard.writeText(text)
	} catch (e) {
		console.error('Clipboard write failed', e)
	}
}

/** Floating toolbar shown above a selected table. Mount via components.InFrontOfTheCanvas. */
export const TableToolbar = track(function TableToolbar() {
	const editor = useEditor()
	const shape = getSelectedTable(editor)
	if (!shape || editor.getInstanceState().isReadonly) return null
	if (editor.getCurrentToolId() !== 'select') return null
	const bounds = editor.getSelectionRotatedScreenBounds()
	if (!bounds) return null
	const selRaw = tableSelection.get()
	const sel = selRaw && selRaw.shapeId === shape.id ? selRaw : null
	const a = activeTableCell.get()
	const colIdx = sel?.kind === 'col' ? sel.index : a && a.shapeId === shape.id ? a.col : null
	const showColStyles = colIdx !== null && colIdx < shape.props.colWidths.length

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
					data-active={
						b.op === 'header-toggle' ? shape.props.headerRow : b.op === 'title-toggle' ? shape.props.showTitle : undefined
					}
					onClick={() => runTableOp(editor, b.op)}
				>
					{b.label}
				</TldrawUiButton>
			))}
			{showColStyles && (
				<>
					<div className="table-toolbar-sep" />
					{COL_BUTTONS.map((b) => {
						const active =
							b.op === 'mono-toggle'
								? shape.props.colMono[colIdx]
								: shape.props.colAlign[colIdx] === b.op.slice(6)
						return (
							<TldrawUiButton
								key={b.op}
								type="normal"
								title={b.title}
								data-active={active}
								onClick={() => runTableOp(editor, active && b.op !== 'mono-toggle' ? 'align-auto' : b.op)}
							>
								{b.label}
							</TldrawUiButton>
						)
					})}
				</>
			)}
		</div>
	)
})
