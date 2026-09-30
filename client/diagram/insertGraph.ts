import {
	createShapeId,
	Editor,
	TLArrowShape,
	TLGeoShape,
	TLShapeId,
	toRichText,
	Vec,
	VecLike,
} from 'tldraw'
import { rowAnchorPoint } from '../../shared/table/tableOps'
import { TABLE_TITLE_HEIGHT, TLTableShape } from '../../shared/table/tableShapeProps'
import type { DiagramGraph, DiagramNode, GeoNode, TableNode } from './graph'
import { computeLayout } from './layout'

const TABLE_ROW_HEIGHT = 32
const CHAR_W = 8.5

function estimateGeoSize(node: GeoNode) {
	const lines = node.label.split('\n')
	const longest = Math.max(...lines.map((l) => l.length), 1)
	let w = Math.min(280, Math.max(120, longest * CHAR_W + 40))
	let h = 56 + (lines.length - 1) * 22
	if (node.shape === 'diamond') {
		w *= 1.4
		h *= 1.5
	} else if (node.shape === 'ellipse' || node.shape === 'oval' || node.shape === 'hexagon') {
		w *= 1.2
		h *= 1.2
	}
	return { w: Math.round(w), h: Math.round(h) }
}

function tableProps(node: TableNode): Partial<TLTableShape['props']> {
	const cells = [node.header, ...node.rows.map((r) => node.header.map((_, i) => r[i] ?? ''))]
	const colMono = node.header.map((h) => /^type$/i.test(h))
	// Table text renders wider than geo labels; monospace wider still
	const colWidths = node.header.map((_, c) => {
		const charW = colMono[c] ? 10.8 : 9.4
		return Math.round(Math.min(320, Math.max(72, ...cells.map((row) => (row[c]?.length ?? 0) * charW + 28))))
	})
	// Make the title fit too
	const titleW = node.title.length * 11 + 40
	const total = colWidths.reduce((a, b) => a + b, 0)
	if (titleW > total) colWidths[colWidths.length - 1] += Math.round(titleW - total)
	const rowHeights = cells.map(() => TABLE_ROW_HEIGHT)
	return {
		w: colWidths.reduce((a, b) => a + b, 0),
		h: TABLE_TITLE_HEIGHT + rowHeights.length * TABLE_ROW_HEIGHT,
		rowIds: [],
		colIds: [],
		colWidths,
		rowHeights,
		cells,
		headerRow: true,
		title: node.title,
		showTitle: true,
		colAlign: node.header.map(() => null),
		// The type column reads better monospaced
		colMono,
	}
}

function createNodeShape(editor: Editor, node: DiagramNode, id: TLShapeId) {
	if (node.kind === 'table') {
		editor.createShape<TLTableShape>({ id, type: 'table', x: 0, y: 0, props: tableProps(node) })
		return
	}
	const { w, h } = estimateGeoSize(node)
	editor.createShape<TLGeoShape>({
		id,
		type: 'geo',
		x: 0,
		y: 0,
		props: {
			geo: node.shape,
			w,
			h,
			richText: toRichText(node.label),
			...(node.color ? { color: node.color } : {}),
		},
	})
}

/**
 * Create a diagram on the canvas: node shapes, a dagre layout, then arrows bound to the nodes
 * (to specific rows for table nodes). Centred on `at` (default: viewport centre) and selected.
 * Returns the ids of everything created.
 */
export function insertGraph(editor: Editor, graph: DiagramGraph, at?: VecLike): TLShapeId[] {
	if (graph.nodes.length === 0) return []
	const shapeIds = new Map<string, TLShapeId>()
	const created: TLShapeId[] = []

	editor.markHistoryStoppingPoint('insert diagram')
	editor.run(() => {
		for (const node of graph.nodes) {
			const id = createShapeId()
			shapeIds.set(node.id, id)
			created.push(id)
			createNodeShape(editor, node, id)
		}

		// Lay out using the real rendered sizes (geo text can grow the shape)
		const sizes = graph.nodes.map((n) => {
			const b = editor.getShapePageBounds(shapeIds.get(n.id)!)!
			return { id: n.id, w: b.w, h: b.h }
		})
		const positions = computeLayout(sizes, graph.edges, { direction: graph.direction })
		const width = Math.max(...sizes.map((s) => positions.get(s.id)!.x + s.w))
		const height = Math.max(...sizes.map((s) => positions.get(s.id)!.y + s.h))
		const center = at ?? editor.getViewportPageBounds().center
		const origin = new Vec(center.x - width / 2, center.y - height / 2)
		editor.updateShapes(
			graph.nodes.map((n) => {
				const p = positions.get(n.id)!
				const shape = editor.getShape(shapeIds.get(n.id)!)!
				return { id: shape.id, type: shape.type, x: origin.x + p.x, y: origin.y + p.y }
			})
		)

		for (const edge of graph.edges) {
			const fromId = shapeIds.get(edge.from)
			const toId = shapeIds.get(edge.to)
			if (!fromId || !toId) continue
			const arrowId = createArrow(editor, graph, edge, fromId, toId)
			if (arrowId) created.push(arrowId)
		}
	})

	editor.select(...created)
	const bounds = editor.getSelectionPageBounds()
	if (bounds && !editor.getViewportPageBounds().contains(bounds)) {
		editor.zoomToBounds(bounds, { inset: 64, animation: { duration: 200 } })
	}
	return created
}

function createArrow(
	editor: Editor,
	graph: DiagramGraph,
	edge: DiagramGraph['edges'][number],
	fromId: TLShapeId,
	toId: TLShapeId
): TLShapeId | null {
	const fromBounds = editor.getShapePageBounds(fromId)
	const toBounds = editor.getShapePageBounds(toId)
	if (!fromBounds || !toBounds) return null
	const fromNode = graph.nodes.find((n) => n.id === edge.from)!
	const toNode = graph.nodes.find((n) => n.id === edge.to)!

	// Table rows attach on the side facing the other table
	const toIsRight = toBounds.center.x >= fromBounds.center.x
	const anchor = (shapeId: TLShapeId, node: DiagramNode, row: number | undefined, side: 'left' | 'right') => {
		if (node.kind !== 'table' || row === undefined) return { normalizedAnchor: { x: 0.5, y: 0.5 }, isPrecise: false }
		const shape = editor.getShape<TLTableShape>(shapeId)!
		const p = rowAnchorPoint(shape.props, row + 1, side)
		return { normalizedAnchor: { x: p.x / shape.props.w, y: p.y / shape.props.h }, isPrecise: true }
	}
	const start = anchor(fromId, fromNode, edge.fromRow, toIsRight ? 'right' : 'left')
	const end = anchor(toId, toNode, edge.toRow, toIsRight ? 'left' : 'right')
	const startPoint = {
		x: fromBounds.x + start.normalizedAnchor.x * fromBounds.w,
		y: fromBounds.y + start.normalizedAnchor.y * fromBounds.h,
	}
	const endPoint = { x: toBounds.x + end.normalizedAnchor.x * toBounds.w, y: toBounds.y + end.normalizedAnchor.y * toBounds.h }

	const id = createShapeId()
	const isTableEdge = fromNode.kind === 'table' || toNode.kind === 'table'
	editor.createShape<TLArrowShape>({
		id,
		type: 'arrow',
		x: startPoint.x,
		y: startPoint.y,
		props: {
			start: { x: 0, y: 0 },
			end: { x: endPoint.x - startPoint.x, y: endPoint.y - startPoint.y },
			kind: isTableEdge ? 'elbow' : 'arc',
			arrowheadEnd: edge.head ?? 'arrow',
			arrowheadStart: edge.tail ?? 'none',
			richText: toRichText(edge.label ?? ''),
			...(edge.dashed ? { dash: 'dashed' as const } : {}),
			...(edge.thick ? { size: 'l' as const } : {}),
		},
	})
	editor.createBindings([
		{
			type: 'arrow',
			fromId: id,
			toId: fromId,
			props: { terminal: 'start', isExact: false, ...start },
		},
		{
			type: 'arrow',
			fromId: id,
			toId: toId,
			props: { terminal: 'end', isExact: false, ...end },
		},
	])
	return id
}
