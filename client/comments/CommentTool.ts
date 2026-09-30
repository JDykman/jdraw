import { Editor, StateNode, VecLike } from 'tldraw'
import { $activeThreadId, $pendingComment } from './commentsApi'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M5 7.5A3.5 3.5 0 0 1 8.5 4h13A3.5 3.5 0 0 1 25 7.5v9a3.5 3.5 0 0 1-3.5 3.5H13l-6 5v-5A3.5 3.5 0 0 1 5 16.5z"/>
<line x1="10" y1="10" x2="20" y2="10"/>
<line x1="10" y1="14" x2="17" y2="14"/>
</svg>`

export const COMMENT_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/**
 * Begin a new thread at a page point: pinned to the shape under it (relative anchor) or to the
 * point itself. The draft popover picks this up from $pendingComment.
 */
export function startCommentAt(editor: Editor, point: VecLike) {
	const shape = editor.getShapeAtPoint(point, { hitInside: true, margin: 4 })
	const bounds = shape ? editor.getShapePageBounds(shape) : undefined
	if (shape && bounds && bounds.w > 0 && bounds.h > 0) {
		$pendingComment.set({
			shapeId: shape.id,
			anchorX: Math.min(1, Math.max(0, (point.x - bounds.x) / bounds.w)),
			anchorY: Math.min(1, Math.max(0, (point.y - bounds.y) / bounds.h)),
			pageX: point.x,
			pageY: point.y,
		})
	} else {
		$pendingComment.set({ shapeId: null, anchorX: point.x, anchorY: point.y, pageX: point.x, pageY: point.y })
	}
	$activeThreadId.set(null)
}

/** Click a shape or the canvas to start a comment thread there, then return to the select tool. */
export class CommentTool extends StateNode {
	static override id = 'comment'

	override isLockable = false

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onExit() {
		this.editor.setCursor({ type: 'default', rotation: 0 })
	}

	override onPointerDown() {
		startCommentAt(this.editor, this.editor.inputs.getCurrentPagePoint())
		this.parent.transition('select', {})
	}

	override onCancel() {
		this.parent.transition('select', {})
	}

	override onInterrupt() {
		this.parent.transition('select', {})
	}
}
