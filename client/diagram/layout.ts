import dagre from '@dagrejs/dagre'
import { Editor, TLArrowBinding, TLArrowShape, TLShape, TLShapeId, Vec } from 'tldraw'
import type { Direction } from './graph'

export interface LayoutNode {
	id: string
	w: number
	h: number
}

export interface LayoutEdge {
	from: string
	to: string
}

export interface LayoutOptions {
	direction: Direction
	nodeSep?: number
	rankSep?: number
}

/** Dagre layered layout. Returns each node's top-left, normalised so the result starts at 0,0. */
export function computeLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: LayoutOptions) {
	const g = new dagre.graphlib.Graph({ multigraph: true })
	const horizontal = opts.direction === 'LR' || opts.direction === 'RL'
	g.setGraph({
		rankdir: opts.direction,
		nodesep: opts.nodeSep ?? (horizontal ? 40 : 60),
		ranksep: opts.rankSep ?? (horizontal ? 100 : 80),
		marginx: 0,
		marginy: 0,
	})
	g.setDefaultEdgeLabel(() => ({}))
	for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h })
	edges.forEach((e, i) => {
		if (e.from !== e.to && g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, {}, `e${i}`)
	})
	dagre.layout(g)

	const out = new Map<string, { x: number; y: number }>()
	let minX = Infinity
	let minY = Infinity
	for (const n of nodes) {
		const { x, y } = g.node(n.id)
		const tl = { x: x - n.w / 2, y: y - n.h / 2 }
		out.set(n.id, tl)
		minX = Math.min(minX, tl.x)
		minY = Math.min(minY, tl.y)
	}
	for (const p of out.values()) {
		p.x -= minX
		p.y -= minY
	}
	return out
}

function arrowEnds(editor: Editor, arrow: TLArrowShape) {
	const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrow.id, 'arrow')
	return {
		start: bindings.find((b) => b.props.terminal === 'start')?.toId,
		end: bindings.find((b) => b.props.terminal === 'end')?.toId,
	}
}

/**
 * The shapes a layout should move: the selection (or the whole page when nothing is selected),
 * minus arrows and anything nested inside another shape in the set.
 */
export function getLayoutTargets(editor: Editor): TLShape[] {
	const selected = editor.getSelectedShapes()
	const pool = selected.length > 0 ? selected : editor.getCurrentPageShapesSorted()
	const ids = new Set(pool.map((s) => s.id))
	return pool.filter(
		(s) =>
			s.type !== 'arrow' &&
			!editor.findShapeAncestor(s, (a) => ids.has(a.id)) &&
			// Only shapes that share a parent can be laid out together
			s.parentId === pool.find((p) => p.type !== 'arrow')?.parentId
	)
}

/**
 * Lay out shapes with dagre using the arrows bound between them as edges.
 * Keeps the group's top-left corner where it was and straightens the arrows involved.
 */
export function layoutShapes(editor: Editor, shapes: TLShape[], direction: Direction) {
	if (shapes.length < 2) return false
	const ids = new Set<TLShapeId>(shapes.map((s) => s.id))
	const nodes: LayoutNode[] = []
	for (const s of shapes) {
		const b = editor.getShapePageBounds(s)
		if (b) nodes.push({ id: s.id, w: b.w, h: b.h })
	}

	const edges: LayoutEdge[] = []
	const arrows: TLArrowShape[] = []
	for (const arrow of editor.getCurrentPageShapes()) {
		if (!editor.isShapeOfType<TLArrowShape>(arrow, 'arrow')) continue
		const { start, end } = arrowEnds(editor, arrow)
		if (start && end && ids.has(start) && ids.has(end)) {
			edges.push({ from: start, to: end })
			arrows.push(arrow)
		}
	}

	const positions = computeLayout(nodes, edges, { direction })
	const bounds = editor.getShapesPageBounds(shapes.map((s) => s.id))
	if (!bounds) return false
	const origin = new Vec(bounds.x, bounds.y)

	editor.markHistoryStoppingPoint('auto layout')
	editor.run(() => {
		editor.updateShapes(
			shapes.map((s) => {
				const pageBounds = editor.getShapePageBounds(s)!
				const target = positions.get(s.id)!
				// Shift the shape by how far its page bounds need to move, in its parent's space
				const delta = Vec.Add(origin, target).sub(pageBounds.point)
				const parentPoint = editor.getPointInParentSpace(s.id, Vec.Add(editor.getShapePageTransform(s).point(), delta))
				return { id: s.id, type: s.type, x: parentPoint.x, y: parentPoint.y }
			})
		)
		editor.updateShapes(arrows.map((a) => ({ id: a.id, type: 'arrow' as const, props: { bend: 0 } })))
	})
	return true
}
