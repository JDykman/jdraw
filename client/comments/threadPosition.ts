import { Editor, TLShapeId } from 'tldraw'
import { ThreadDto } from './commentsApi'

export interface ThreadPagePoint {
	x: number
	y: number
	/** The thread was pinned to a shape that no longer exists; this is its last known spot. */
	shapeMissing: boolean
}

/**
 * Where a thread sits in page space right now: the shape's bounds plus the relative anchor,
 * the last known position if the shape is gone, or the fixed point for canvas comments.
 * Returns null when it can't be placed (shape on another tldraw page, or gone with no fallback).
 */
export function getThreadPagePoint(editor: Editor, thread: ThreadDto): ThreadPagePoint | null {
	if (thread.shapeId) {
		const shape = editor.getShape(thread.shapeId as TLShapeId)
		if (shape) {
			if (editor.getAncestorPageId(shape) !== editor.getCurrentPageId()) return null
			const bounds = editor.getShapePageBounds(shape)
			if (bounds) {
				return { x: bounds.x + thread.anchorX * bounds.w, y: bounds.y + thread.anchorY * bounds.h, shapeMissing: false }
			}
		}
		if (thread.lastX !== null && thread.lastY !== null) return { x: thread.lastX, y: thread.lastY, shapeMissing: true }
		return null
	}
	return { x: thread.anchorX, y: thread.anchorY, shapeMissing: false }
}
