import dagre from '@dagrejs/dagre'
import { Editor, TLArrowBinding, TLArrowShape, TLShape, TLShapeId, Vec } from 'tldraw'
import type { Direction } from './graph'

export interface LayoutNode {
	id: string
	w: number
	h: number
	/** Cluster the node belongs to; clusters are laid out as compound dagre nodes */
	group?: string
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

/** Room a frame keeps around its members (the title sits above the frame, so no extra top). */
export const GROUP_PADDING = 28

export interface LayoutResult {
	positions: Map<string, { x: number; y: number }>
	/** Bounding box per group, padding included, in the same normalised space */
	groups: Map<string, { x: number; y: number; w: number; h: number }>
}

/** One dagre pass. Returns each node's top-left, normalised so the result starts at 0,0. */
function layoutFlat(nodes: LayoutNode[], edges: LayoutEdge[], opts: LayoutOptions) {
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

	const positions = new Map<string, { x: number; y: number }>()
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const n of nodes) {
		const { x, y } = g.node(n.id)
		const tl = { x: x - n.w / 2, y: y - n.h / 2 }
		positions.set(n.id, tl)
		minX = Math.min(minX, tl.x)
		minY = Math.min(minY, tl.y)
		maxX = Math.max(maxX, tl.x + n.w)
		maxY = Math.max(maxY, tl.y + n.h)
	}
	for (const p of positions.values()) {
		p.x -= minX
		p.y -= minY
	}
	return { positions, w: maxX - minX, h: maxY - minY }
}

/**
 * Dagre layered layout. Without groups it is a single pass. With groups it runs in two levels:
 * each group is laid out on its own (compact frames), then the groups and any ungrouped nodes
 * are laid out as blocks using the edges between them. Dagre's own compound clusters spread a
 * group's members across every rank its edges touch, which leaves sprawling, mostly empty frames.
 */
export function computeLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: LayoutOptions): LayoutResult {
	const groupIds = [...new Set(nodes.flatMap((n) => (n.group ? [n.group] : [])))]
	if (groupIds.length === 0) {
		return { positions: layoutFlat(nodes, edges, opts).positions, groups: new Map() }
	}

	const groupOf = new Map(nodes.map((n) => [n.id, n.group]))
	const blockOf = (id: string) => groupOf.get(id) ?? id

	// Level 1: each group on its own, with the edges inside it
	const inner = new Map<string, ReturnType<typeof layoutFlat>>()
	for (const gid of groupIds) {
		const members = nodes.filter((n) => n.group === gid)
		const intra = edges.filter((e) => groupOf.get(e.from) === gid && groupOf.get(e.to) === gid)
		inner.set(gid, layoutFlat(members, intra, opts))
	}

	// Level 2: groups as padded blocks plus the loose nodes, joined by the edges between blocks
	const blocks: LayoutNode[] = [
		...groupIds.map((gid) => {
			const { w, h } = inner.get(gid)!
			return { id: gid, w: w + GROUP_PADDING * 2, h: h + GROUP_PADDING * 2 }
		}),
		...nodes.filter((n) => !n.group),
	]
	const seen = new Set<string>()
	const between: LayoutEdge[] = []
	for (const e of edges) {
		const from = blockOf(e.from)
		const to = blockOf(e.to)
		if (from === to || seen.has(`${from}>${to}`)) continue
		seen.add(`${from}>${to}`)
		between.push({ from, to })
	}
	const horizontal = opts.direction === 'LR' || opts.direction === 'RL'
	const outer = layoutFlat(blocks, between, {
		direction: opts.direction,
		nodeSep: opts.nodeSep ?? (horizontal ? 60 : 80),
		rankSep: opts.rankSep ?? (horizontal ? 140 : 120),
	})

	const positions = new Map<string, { x: number; y: number }>()
	const groups = new Map<string, { x: number; y: number; w: number; h: number }>()
	for (const b of blocks) {
		const at = outer.positions.get(b.id)!
		const group = inner.get(b.id)
		if (!group) {
			positions.set(b.id, at)
			continue
		}
		groups.set(b.id, { x: at.x, y: at.y, w: b.w, h: b.h })
		for (const [id, p] of group.positions) {
			positions.set(id, { x: at.x + GROUP_PADDING + p.x, y: at.y + GROUP_PADDING + p.y })
		}
	}
	return { positions, groups }
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

	const { positions } = computeLayout(nodes, edges, { direction })
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
