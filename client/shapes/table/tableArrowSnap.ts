import { Editor, TLArrowBinding, TLBinding, Vec } from 'tldraw'
import { TLTableShape } from '../../../shared/table/tableShapeProps'
import { isRetargetingTableArrows } from './tableArrowRetarget'
import { tableSnapPoints } from '../../../shared/table/tableOps'

/** Screen pixels within which an arrow endpoint snaps to a row/column point. */
const SNAP_THRESHOLD_PX = 18

/**
 * tldraw's arrow terminals don't participate in handle snapping, so getHandleSnapGeometry is
 * never consulted for arrows. Instead, whenever an arrow binding to a table is written while the
 * user is dragging, move its anchor to the nearest row/column snap point (if within threshold)
 * and make the binding precise so the arrow lands exactly there.
 */
export function registerTableArrowSnapping(editor: Editor) {
	const snap = (binding: TLBinding): TLBinding => {
		if (binding.type !== 'arrow') return binding
		if (isRetargetingTableArrows()) return binding
		if (!editor.inputs.getIsPointing()) return binding
		// Only snap while an arrow is being drawn or its endpoint dragged, not during e.g. a divider drag.
		const arrow = editor.getShape(binding.fromId)
		if (!arrow || !editor.getSelectedShapeIds().includes(arrow.id)) return binding
		const target = editor.getShape(binding.toId)
		if (!target || !editor.isShapeOfType<TLTableShape>(target, 'table')) return binding

		const pointer = editor.getPointInShapeSpace(target, editor.inputs.getCurrentPagePoint())
		const threshold = SNAP_THRESHOLD_PX / editor.getZoomLevel()

		let best: { x: number; y: number } | null = null
		let bestD = threshold
		for (const p of tableSnapPoints(target.props)) {
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
