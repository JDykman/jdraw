import { Editor, TLArrowBinding, TLArrowShape, TLGeoShape, TLShape, TLShapeId } from 'tldraw'
import type { DiagramEdge, DiagramGraph, Direction, GeoNode } from './graph'

const HEAD: Record<string, DiagramEdge['head']> = {
	arrow: 'arrow',
	triangle: 'arrow',
	inverted: 'arrow',
	diamond: 'arrow',
	square: 'arrow',
	dot: 'dot',
	bar: 'bar',
	pipe: 'bar',
	none: 'none',
}

function slug(label: string) {
	const base = label
		.split('\n')[0]
		.replace(/[^\w\s]/g, '')
		.trim()
		.split(/\s+/)
		.slice(0, 3)
		.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
		.join('')
	return /^[A-Za-z_]/.test(base) ? base.slice(0, 24) : ''
}

/**
 * Read shapes and the arrows connecting them back into a graph (for Mermaid export).
 * Uses the selection, or the whole page when nothing is selected. Only box-like shapes with
 * text become nodes; arrows count when both ends are bound to nodes.
 */
export function canvasToGraph(editor: Editor): DiagramGraph | null {
	const selected = editor.getSelectedShapes()
	const pool: TLShape[] = selected.length ? selected : editor.getCurrentPageShapesSorted()
	const candidates = pool.filter((s) => ['geo', 'text', 'note'].includes(s.type))
	if (candidates.length === 0) return null

	const ids = new Map<TLShapeId, string>()
	const used = new Set<string>()
	const nodes: GeoNode[] = candidates.map((s, i) => {
		const label = editor.getShapeUtil(s).getText(s)?.trim() || `Node ${i + 1}`
		let id = slug(label) || `n${i + 1}`
		if (used.has(id)) id = `${id}${i + 1}`
		used.add(id)
		ids.set(s.id, id)
		const shape = s.type === 'geo' ? (s as TLGeoShape).props.geo : 'rectangle'
		return { kind: 'geo', id, label, shape }
	})

	const edges: DiagramEdge[] = []
	let dx = 0
	let dy = 0
	for (const arrow of editor.getCurrentPageShapes()) {
		if (!editor.isShapeOfType<TLArrowShape>(arrow, 'arrow')) continue
		const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrow.id, 'arrow')
		const start = bindings.find((b) => b.props.terminal === 'start')?.toId
		const end = bindings.find((b) => b.props.terminal === 'end')?.toId
		if (!start || !end || !ids.has(start) || !ids.has(end)) continue
		const a = editor.getShapePageBounds(start)!.center
		const b = editor.getShapePageBounds(end)!.center
		dx += b.x - a.x
		dy += b.y - a.y
		edges.push({
			from: ids.get(start)!,
			to: ids.get(end)!,
			label: editor.getShapeUtil(arrow).getText(arrow)?.trim() || undefined,
			dashed: arrow.props.dash === 'dashed' || arrow.props.dash === 'dotted' || undefined,
			thick: arrow.props.size === 'l' || arrow.props.size === 'xl' || undefined,
			head: HEAD[arrow.props.arrowheadEnd] ?? 'arrow',
			tail: HEAD[arrow.props.arrowheadStart] ?? 'none',
		})
	}

	// Pick the direction the arrows mostly point in
	const direction: Direction =
		Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'LR' : 'RL') : dy >= 0 || edges.length === 0 ? 'TB' : 'BT'
	return { direction, nodes, edges }
}
