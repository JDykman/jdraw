import { Router } from 'express'
import { deleteCheckpoint, getCheckpoint, listCheckpoints } from '../db/checkpoints.js'
import { db } from '../db/db.js'
import { authMiddleware } from '../middleware/auth.js'
import { captureCheckpoint, restoreCheckpoint } from '../sync/checkpoints.js'
import { isPageLoadFailed } from '../sync/roomManager.js'
import { canAccess } from './pages.js'

const router = Router()
router.use(authMiddleware)

const MAX_LABEL_LENGTH = 120

function isOwner(userId: string, pageId: string): boolean {
	return !!db.prepare('SELECT 1 FROM pages WHERE id = ? AND owner_id = ?').get(pageId, userId)
}

// Checkpoint metadata (no snapshots), newest first, plus what the caller may do with them
router.get('/:id/checkpoints', (req, res) => {
	const { allowed, canEdit } = canAccess(req.user!.id, req.params.id)
	if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	res.json({
		checkpoints: listCheckpoints(req.params.id),
		canEdit,
		isOwner: isOwner(req.user!.id, req.params.id),
		loadFailed: isPageLoadFailed(req.params.id),
	})
})

// One checkpoint including its snapshot (for compare)
router.get('/:id/checkpoints/:cid', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const checkpoint = getCheckpoint(req.params.id, req.params.cid)
	if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found' }); return }
	res.json(checkpoint)
})

// Manual checkpoint of the current document
router.post('/:id/checkpoints', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).canEdit) { res.status(403).json({ error: 'Forbidden' }); return }
	const rawLabel = (req.body as { label?: unknown } | undefined)?.label
	if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
		res.status(400).json({ error: 'label must be a string' })
		return
	}
	const label = typeof rawLabel === 'string' ? rawLabel.trim().slice(0, MAX_LABEL_LENGTH) || null : null
	const checkpoint = captureCheckpoint(req.params.id, 'manual', { label, createdBy: req.user!.id })
	if (!checkpoint) {
		res.status(409).json({ error: "This page's stored version couldn't be loaded, so it can't be checkpointed. Restore a version instead." })
		return
	}
	res.status(201).json({ ...checkpoint, createdByName: req.user!.username })
})

router.post('/:id/checkpoints/:cid/restore', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).canEdit) { res.status(403).json({ error: 'Forbidden' }); return }
	const result = restoreCheckpoint(req.params.id, req.params.cid, req.user!.id)
	if (!result.ok) { res.status(result.status).json({ error: result.error }); return }
	res.json({ ok: true, preRestore: result.preRestore })
})

// Owner only; auto and pre-restore checkpoints expire on their own
router.delete('/:id/checkpoints/:cid', (req, res) => {
	if (!isOwner(req.user!.id, req.params.id)) { res.status(403).json({ error: 'Forbidden' }); return }
	const checkpoint = getCheckpoint(req.params.id, req.params.cid)
	if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found' }); return }
	if (checkpoint.kind !== 'manual' && checkpoint.kind !== 'quarantine') {
		res.status(400).json({ error: 'Only manual and quarantine checkpoints can be deleted' })
		return
	}
	deleteCheckpoint(req.params.id, req.params.cid)
	res.json({ ok: true })
})

export default router
