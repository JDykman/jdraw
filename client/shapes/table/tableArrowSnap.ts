import { Editor, TLArrowBinding, TLBinding, Vec } from 'tldraw'
import { TLTableShape } from '../../../shared/table/tableShapeProps'
import { cumulative, titleHeight } from './tableOps'

/** Screen pixels within which an arrow endpoint snaps to a row/column point. */
const SNAP_THRESHOLD_PX = 18

/** Snap points in shape space: every row midpoint on the left/right edges, every column midpoint top/bottom. */
export function getTableSnapPoints(shape: TLTableShape): Vec[] {
	const { w, h, colWidths, rowHeights } = shape.props
	const th = titleHeight(shape.props)
	const cx = cumulative(colWidths)
	const cy = cumulative(rowHeights)
	const pts: Vec[] = []
	rowHeights.forEach((rh, i) => {
		const y = th + cy[i] + rh / 2
		pts.push(new Vec(0, y), new Vec(w, y))
	})
	colWidths.forEach((cw, i) => {
		const x = cx[i] + cw / 2
		pts.push(new Vec(x, 0), new Vec(x, h))
	})
	if (th > 0) pts.push(new Vec(0, th / 2), new Vec(w, th / 2))
	return pts
}

/**
 * tldraw's arrow terminals don't participate in handle snapping, so getHandleSnapGeometry is
 * never consulted for arrows. Instead, whenever an arrow binding to a table is written while the
 * user is dragging, move its anchor to the nearest row/column snap point (if within threshold)
 * and make the binding precise so the arrow lands exactly there.
 */
export function registerTableArrowSnapping(editor: Editor) {
	const snap = (binding: TLBinding): TLBinding => {
		if (binding.type !== 'arrow') return binding
		if (!editor.inputs.getIsPointing()) return binding
		const target = editor.getShape(binding.toId)
		if (!target || !editor.isShapeOfType<TLTableShape>(target, 'table')) return binding

		const pointer = editor.getPointInShapeSpace(target, editor.inputs.getCurrentPagePoint())
		const threshold = SNAP_THRESHOLD_PX / editor.getZoomLevel()

		let best: Vec | null = null
		let bestD = threshold
		for (const p of getTableSnapPoints(target)) {
			const d = Vec.Dist(p, pointer)
			if (d < bestD) {
				bestD = d
				best = p
			}
		}
		if (!best) return binding

		const b = binding as TLArrowBinding
		const normalizedAnchor = { x: best.x / target.props.w, y: best.y / target.props.h }
		if (
			b.props.isPrecise &&
			Math.abs(b.props.normalizedAnchor.x - normalizedAnchor.x) < 1e-6 &&
			Math.abs(b.props.normalizedAnchor.y - normalizedAnchor.y) < 1e-6
		) {
			return binding
		}
		return { ...b, props: { ...b.props, normalizedAnchor, isPrecise: true, snap: 'edge-point' } }
	}

	const d1 = editor.sideEffects.registerBeforeCreateHandler('binding', (b) => snap(b))
	const d2 = editor.sideEffects.registerBeforeChangeHandler('binding', (_prev, next) => snap(next))
	return () => {
		d1()
		d2()
	}
}
