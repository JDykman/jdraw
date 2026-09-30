import { Router } from 'express'
import { CommentsChangedMessage } from '../../shared/sync/customMessages.js'
import {
	addComment,
	createThread,
	deleteComment,
	deleteThread,
	getComment,
	getThread,
	getUnreadCounts,
	listMentionableUsers,
	listThreads,
	markPageRead,
	MAX_COMMENT_LENGTH,
	setThreadResolved,
	updateCommentBody,
	updateThreadPosition,
} from '../db/comments.js'
import { db } from '../db/db.js'
import { authMiddleware } from '../middleware/auth.js'
import { sendCustomMessageToPage } from '../sync/roomManager.js'
import { canAccess } from './pages.js'

// Mounted under /api/pages
const router = Router()
router.use(authMiddleware)

function isOwner(userId: string, pageId: string): boolean {
	return !!db.prepare('SELECT 1 FROM pages WHERE id = ? AND owner_id = ?').get(pageId, userId)
}

/** Tell everyone connected to the page to refetch its threads. */
function notifyPage(pageId: string) {
	const message: CommentsChangedMessage = { type: 'comments-changed', pageId }
	sendCustomMessageToPage(pageId, message)
}

function readBody(raw: unknown): string | null {
	if (typeof raw !== 'string') return null
	const body = raw.trim()
	if (!body || body.length > MAX_COMMENT_LENGTH) return null
	return body
}

function finiteOrNull(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Threads with their comments, plus who can be mentioned and what the caller may do
router.get('/:id/comments', (req, res) => {
	const { allowed, canEdit } = canAccess(req.user!.id, req.params.id)
	if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	res.json({
		threads: listThreads(req.params.id),
		users: listMentionableUsers(req.params.id),
		canEdit,
		isOwner: isOwner(req.user!.id, req.params.id),
	})
})

// New thread with its first comment. Anyone with access, read-only shares included.
router.post('/:id/comments/threads', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const input = (req.body ?? {}) as Record<string, unknown>
	const body = readBody(input.body)
	const anchorX = finiteOrNull(input.anchorX)
	const anchorY = finiteOrNull(input.anchorY)
	if (!body || anchorX === null || anchorY === null) {
		res.status(400).json({ error: 'body, anchorX and anchorY are required' })
		return
	}
	const shapeId = typeof input.shapeId === 'string' && input.shapeId ? input.shapeId : null
	const thread = createThread({
		pageId: req.params.id,
		shapeId,
		anchorX,
		anchorY,
		lastX: finiteOrNull(input.lastX) ?? (shapeId ? null : anchorX),
		lastY: finiteOrNull(input.lastY) ?? (shapeId ? null : anchorY),
		body,
		authorId: req.user!.id,
	})
	notifyPage(req.params.id)
	res.status(201).json(thread)
})

// Resolve / reopen (anyone with access) and refresh the fallback position
router.patch('/:id/comments/threads/:tid', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const thread = getThread(req.params.id, req.params.tid)
	if (!thread) { res.status(404).json({ error: 'Thread not found' }); return }
	const input = (req.body ?? {}) as Record<string, unknown>
	let changed = false
	if (typeof input.resolved === 'boolean' && input.resolved !== (thread.resolvedAt !== null)) {
		setThreadResolved(thread.id, input.resolved, req.user!.id)
		changed = true
	}
	const lastX = finiteOrNull(input.lastX)
	const lastY = finiteOrNull(input.lastY)
	if (lastX !== null && lastY !== null && (lastX !== thread.lastX || lastY !== thread.lastY)) {
		updateThreadPosition(thread.id, lastX, lastY)
		changed = true
	}
	if (changed && typeof input.resolved === 'boolean') notifyPage(req.params.id)
	res.json(getThread(req.params.id, thread.id))
})

// Whole thread: page owner only
router.delete('/:id/comments/threads/:tid', (req, res) => {
	if (!isOwner(req.user!.id, req.params.id)) { res.status(403).json({ error: 'Forbidden' }); return }
	const thread = getThread(req.params.id, req.params.tid)
	if (!thread) { res.status(404).json({ error: 'Thread not found' }); return }
	deleteThread(thread.id)
	notifyPage(req.params.id)
	res.json({ ok: true })
})

router.post('/:id/comments/threads/:tid/comments', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const thread = getThread(req.params.id, req.params.tid)
	if (!thread) { res.status(404).json({ error: 'Thread not found' }); return }
	const body = readBody((req.body as { body?: unknown } | undefined)?.body)
	if (!body) { res.status(400).json({ error: 'body is required' }); return }
	const comment = addComment(req.params.id, thread.id, req.user!.id, body)
	notifyPage(req.params.id)
	res.status(201).json(comment)
})

// Edit: author only
router.patch('/:id/comments/:cid', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const comment = getComment(req.params.id, req.params.cid)
	if (!comment) { res.status(404).json({ error: 'Comment not found' }); return }
	if (comment.authorId !== req.user!.id) { res.status(403).json({ error: 'Only the author can edit a comment' }); return }
	const body = readBody((req.body as { body?: unknown } | undefined)?.body)
	if (!body) { res.status(400).json({ error: 'body is required' }); return }
	const updated = updateCommentBody(req.params.id, comment.id, body)
	notifyPage(req.params.id)
	res.json(updated)
})

// Delete: author or page owner
router.delete('/:id/comments/:cid', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const comment = getComment(req.params.id, req.params.cid)
	if (!comment) { res.status(404).json({ error: 'Comment not found' }); return }
	if (comment.authorId !== req.user!.id && !isOwner(req.user!.id, req.params.id)) {
		res.status(403).json({ error: 'Forbidden' })
		return
	}
	const result = deleteComment(comment.threadId, comment.id)
	notifyPage(req.params.id)
	res.json({ ok: true, ...result })
})

// The current user has seen this page's comments
router.post('/:id/comments/read', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	markPageRead(req.user!.id, req.params.id)
	res.json({ ok: true })
})

export default router

// Mounted at /api/notifications: unread comment and mention counts per page for the current user
export const notificationsRouter = Router()
notificationsRouter.use(authMiddleware)
notificationsRouter.get('/', (req, res) => {
	const counts = getUnreadCounts(req.user!.id)
	res.json({ pages: Object.fromEntries(counts) })
})
