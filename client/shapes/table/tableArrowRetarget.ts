import { Editor, TLArrowBinding, TLShape } from 'tldraw'
import { TLTableShape, TLTableShapeProps } from '../../../shared/table/tableShapeProps'
import { cumulative, titleHeight } from './tableOps'

const EDGE_EPS = 0.5

/** True while we are rewriting anchors, so the drag-snap handler leaves them alone. */
let retargeting = false
export const isRetargetingTableArrows = () => retargeting

type Axis = { ids: string[]; sizes: number[]; offset: number; total: number }

function axes(p: TLTableShapeProps): { x: Axis; y: Axis } {
	return {
		x: { ids: p.colIds, sizes: p.colWidths, offset: 0, total: p.w },
		y: { ids: p.rowIds, sizes: p.rowHeights, offset: titleHeight(p), total: p.h },
	}
}

/**
 * Map one coordinate from the old layout to the new one along an axis.
 *  - On an outer edge (0 or total) → stays on that edge.
 *  - Inside the title band (y only) → stays in the title band, same fraction.
 *  - Inside a row/column → same id, same fraction within it. If that id was deleted,
 *    the nearest surviving neighbour (by old index) takes it.
 */
function remap(v: number, prev: Axis, next: Axis): number {
	if (v <= EDGE_EPS) return 0
	if (v >= prev.total - EDGE_EPS) return next.total

	if (v < prev.offset) {
		// title band
		return next.offset > 0 ? (v / prev.offset) * next.offset : 0
	}

	const starts = cumulative(prev.sizes).map((s) => s + prev.offset)
	let i = prev.sizes.length - 1
	for (let k = 0; k < prev.sizes.length; k++) {
		if (v < starts[k + 1]) {
			i = k
			break
		}
	}
	const frac = prev.sizes[i] > 0 ? (v - starts[i]) / prev.sizes[i] : 0.5

	const nextIndexById = new Map(next.ids.map((id, k) => [id, k] as const))
	let j = nextIndexById.get(prev.ids[i])
	if (j === undefined) {
		// Deleted: search outward in the old order for a surviving neighbour.
		for (let d = 1; d < prev.ids.length && j === undefined; d++) {
			j = nextIndexById.get(prev.ids[i + d]) ?? nextIndexById.get(prev.ids[i - d])
		}
		if (j === undefined) return next.total / 2
	}
	const nextStarts = cumulative(next.sizes).map((s) => s + next.offset)
	return nextStarts[j] + frac * next.sizes[j]
}

function layoutChanged(a: TLTableShapeProps, b: TLTableShapeProps) {
	return (
		a.colWidths !== b.colWidths ||
		a.rowHeights !== b.rowHeights ||
		a.colIds !== b.colIds ||
		a.rowIds !== b.rowIds ||
		a.showTitle !== b.showTitle
	)
}

/**
 * Keep arrows attached to the same row/column when a table's layout changes
 * (insert, delete, reorder, divider drag, paste, title toggle). Box resize is
 * proportional, so anchors are unchanged by it and this is a no-op there.
 */
export function registerTableArrowRetargeting(editor: Editor) {
	// Undo/redo/bail replay the table change AND the binding change from history together.
	// Re-running the remap on top of that would move the anchor twice, so skip while replaying.
	// (Checking "history paused" isn't enough: the agent makes real edits with history: 'ignore'.)
	let replaying = 0
	const methods = ['undo', 'redo', 'bail', 'bailToMark'] as const
	const originals = methods.map((m) => {
		const orig = (editor[m] as (...a: any[]) => Editor).bind(editor)
		;(editor as any)[m] = (...args: any[]) => {
			replaying++
			try {
				return orig(...args)
			} finally {
				replaying--
			}
		}
		return [m, orig] as const
	})

	const dispose = editor.sideEffects.registerAfterChangeHandler('shape', (prev: TLShape, next: TLShape, source) => {
		// The client that made the change already rewrote the bindings and synced them.
		if (source !== 'user' || replaying > 0) return
		if (next.type !== 'table' || prev.type !== 'table') return
		const p = (prev as TLTableShape).props
		const n = (next as TLTableShape).props
		if (!layoutChanged(p, n)) return

		const bindings = editor.getBindingsToShape<TLArrowBinding>(next.id, 'arrow')
		if (!bindings.length) return

		const pa = axes(p)
		const na = axes(n)
		const updates = bindings.flatMap((b) => {
			const x = remap(b.props.normalizedAnchor.x * p.w, pa.x, na.x) / n.w
			const y = remap(b.props.normalizedAnchor.y * p.h, pa.y, na.y) / n.h
			if (Math.abs(x - b.props.normalizedAnchor.x) < 1e-6 && Math.abs(y - b.props.normalizedAnchor.y) < 1e-6) return []
			return [{ id: b.id, type: 'arrow' as const, props: { ...b.props, normalizedAnchor: { x, y } } }]
		})
		if (!updates.length) return

		retargeting = true
		try {
			editor.updateBindings(updates)
		} finally {
			retargeting = false
		}
	})

	return () => {
		dispose()
		for (const [m, orig] of originals) (editor as any)[m] = orig
	}
}
