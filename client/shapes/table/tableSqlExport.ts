import { Editor, TLArrowBinding, TLShapeId } from 'tldraw'
import { rowAtEdgeAnchor } from '../../../shared/table/tableOps'
import { entityColumnName, entityRowIsPk, SqlRef, sqlTableName, tablesToSql } from '../../../shared/table/tableSql'
import { TLTableShape } from '../../../shared/table/tableShapeProps'

export function getSelectedTables(editor: Editor): TLTableShape[] {
	return editor
		.getSelectedShapes()
		.filter((s): s is TLTableShape => editor.isShapeOfType<TLTableShape>(s, 'table'))
		.sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * Foreign keys implied by arrows drawn between rows of two selected tables. The row marked PK is
 * the referenced side; if neither or both are, the arrow's end is the referenced side.
 */
function refsFromArrows(editor: Editor, tables: TLTableShape[], names: Map<TLShapeId, string>) {
	const refs = new Map<TLShapeId, Map<number, SqlRef>>()
	const ids = new Set(tables.map((t) => t.id))
	const arrows = new Map<TLShapeId, { start?: TLArrowBinding; end?: TLArrowBinding }>()
	for (const t of tables) {
		for (const b of editor.getBindingsToShape<TLArrowBinding>(t.id, 'arrow')) {
			const entry = arrows.get(b.fromId) ?? {}
			entry[b.props.terminal] = b
			arrows.set(b.fromId, entry)
		}
	}
	const rowOf = (b: TLArrowBinding) => {
		const t = editor.getShape<TLTableShape>(b.toId)!
		const r = rowAtEdgeAnchor(t.props, b.props.normalizedAnchor.x * t.props.w, b.props.normalizedAnchor.y * t.props.h)
		return r === null || r === 0 ? null : { t, r }
	}
	for (const { start, end } of arrows.values()) {
		if (!start || !end || !ids.has(start.toId) || !ids.has(end.toId) || start.toId === end.toId) continue
		const a = rowOf(start)
		const b = rowOf(end)
		if (!a || !b) continue
		const aPk = entityRowIsPk(a.t.props, a.r)
		const bPk = entityRowIsPk(b.t.props, b.r)
		const [fk, pk] = aPk && !bPk ? [b, a] : [a, b]
		const column = entityColumnName(pk.t.props, pk.r)
		if (!column) continue
		const m = refs.get(fk.t.id) ?? new Map<number, SqlRef>()
		if (!m.has(fk.r)) m.set(fk.r, { table: names.get(pk.t.id)!, column })
		refs.set(fk.t.id, m)
	}
	return refs
}

export function selectedTablesToSql(editor: Editor): string | null {
	const tables = getSelectedTables(editor)
	if (!tables.length) return null
	const names = new Map(tables.map((t, i) => [t.id, sqlTableName(t.props, `table_${i + 1}`).replace(/^"|"$/g, '')]))
	const refs = refsFromArrows(editor, tables, names)
	return tablesToSql(
		tables.map((t, i) => ({ props: t.props, refs: refs.get(t.id), fallbackName: `table_${i + 1}` }))
	)
}

export async function copySelectedTablesAsSql(editor: Editor) {
	const sql = selectedTablesToSql(editor)
	if (!sql) return
	try {
		await navigator.clipboard.writeText(sql)
	} catch (e) {
		console.error('Clipboard write failed', e)
	}
}
