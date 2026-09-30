import { TLShapeId } from 'tldraw'
import { TableEditAction, TableEditOp } from '../../shared/schema/AgentActionSchemas'
import {
	deleteCol,
	deleteRow,
	fillCells,
	insertCol,
	insertRow,
	moveCol,
	moveRow,
	normalizeTable,
} from '../../shared/table/tableOps'
import { TLTableShape, TLTableShapeProps } from '../../shared/table/tableShapeProps'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Apply one op to table props. Returns the new props, or a string describing why it was skipped. */
export function applyTableEditOp(p: TLTableShapeProps, op: TableEditOp): TLTableShapeProps | string {
	const rows = p.rowHeights.length
	const cols = p.colWidths.length
	switch (op.op) {
		case 'insert-row': {
			if (!isInt(op.index)) return 'index must be an integer'
			const at = Math.max(0, Math.min(op.index, rows))
			let next = insertRow(p, at)
			if (op.values?.length) next = fillCells(next, at, 0, [op.values.map(String)])
			return next
		}
		case 'insert-column': {
			if (!isInt(op.index)) return 'index must be an integer'
			const at = Math.max(0, Math.min(op.index, cols))
			let next = insertCol(p, at)
			if (op.width && op.width > 0) {
				const colWidths = [...next.colWidths]
				colWidths[at] = op.width
				next = normalizeTable({ ...next, colWidths })
			}
			if (op.values?.length) next = fillCells(next, 0, at, op.values.map((v) => [String(v)]))
			return next
		}
		case 'delete-row':
			if (!isInt(op.index) || op.index < 0 || op.index >= rows) return `row ${op.index} out of range (0-${rows - 1})`
			if (rows <= 1) return 'cannot delete the last row'
			return deleteRow(p, op.index)
		case 'delete-column':
			if (!isInt(op.index) || op.index < 0 || op.index >= cols) return `column ${op.index} out of range (0-${cols - 1})`
			if (cols <= 1) return 'cannot delete the last column'
			return deleteCol(p, op.index)
		case 'move-row':
			if (!isInt(op.from) || !isInt(op.to) || op.from < 0 || op.from >= rows || op.to < 0 || op.to >= rows)
				return `move-row ${op.from}->${op.to} out of range (0-${rows - 1})`
			return moveRow(p, op.from, op.to)
		case 'move-column':
			if (!isInt(op.from) || !isInt(op.to) || op.from < 0 || op.from >= cols || op.to < 0 || op.to >= cols)
				return `move-column ${op.from}->${op.to} out of range (0-${cols - 1})`
			return moveCol(p, op.from, op.to)
		case 'set-cell':
			// Out-of-range cells grow the table, like pasting past the edge.
			if (!isInt(op.row) || !isInt(op.col) || op.row < 0 || op.col < 0) return 'row/col must be non-negative integers'
			return fillCells(p, op.row, op.col, [[String(op.text ?? '')]])
		case 'set-row':
			if (!isInt(op.row) || op.row < 0) return 'row must be a non-negative integer'
			return fillCells(p, op.row, 0, [(op.values ?? []).map(String)])
		case 'set-title': {
			const title = String(op.title ?? '')
			return normalizeTable({ ...p, title, showTitle: title.trim() !== '' })
		}
		case 'set-header-row':
			return { ...p, headerRow: !!op.enabled }
		case 'set-column-mono': {
			if (!isInt(op.col) || op.col < 0 || op.col >= cols) return `column ${op.col} out of range (0-${cols - 1})`
			const colMono = [...p.colMono]
			colMono[op.col] = !!op.enabled
			return { ...p, colMono }
		}
		default:
			return `unknown op ${(op as { op?: string }).op}`
	}
}

export const TableEditActionUtil = registerActionUtil(
	class TableEditActionUtil extends AgentActionUtil<TableEditAction> {
		static override type = 'table-edit' as const

		override getInfo(action: Streaming<TableEditAction>) {
			return {
				icon: 'pencil' as const,
				description: action.intent ?? '',
			}
		}

		override sanitizeAction(action: Streaming<TableEditAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			const shapeId = helpers.ensureShapeIdExists(action.shapeId)
			if (!shapeId) return null
			const shape = this.editor.getShape(`shape:${shapeId}` as TLShapeId)
			if (!shape || shape.type !== 'table') {
				console.warn(`table-edit: shape ${shapeId} is not a table`)
				return null
			}
			action.shapeId = shapeId
			action.ops = Array.isArray(action.ops) ? action.ops.filter((o) => o && typeof o.op === 'string') : []
			return action
		}

		override applyAction(action: Streaming<TableEditAction>) {
			if (!action.complete) return
			const { editor } = this
			const id = `shape:${action.shapeId}` as TLShapeId
			const shape = editor.getShape<TLTableShape>(id)
			if (!shape || shape.type !== 'table') return

			let props = shape.props
			for (const op of action.ops) {
				const result = applyTableEditOp(props, op)
				if (typeof result === 'string') {
					console.warn(`table-edit: skipped ${op.op}: ${result}`)
					continue
				}
				props = result
			}
			if (props !== shape.props) editor.updateShape({ id, type: 'table', props })
		}
	}
)
