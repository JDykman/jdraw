import { randomUUID } from 'crypto'
import { Router } from 'express'
import { db } from '../db/db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware)

export function canAccess(userId: string, pageId: string): { allowed: boolean; canEdit: boolean } {
	const owned = db.prepare('SELECT 1 FROM pages WHERE id = ? AND owner_id = ?').get(pageId, userId)
	if (owned) return { allowed: true, canEdit: true }
	const shared = db
		.prepare('SELECT can_edit FROM page_shares WHERE page_id = ? AND user_id = ?')
		.get(pageId, userId) as { can_edit: number } | undefined
	if (shared) return { allowed: true, canEdit: shared.can_edit === 1 }
	return { allowed: false, canEdit: false }
}

// List pages accessible to the current user
router.get('/', (req, res) => {
	const userId = req.user!.id
	const owned = db
		.prepare('SELECT id, name, owner_id, created_at, updated_at FROM pages WHERE owner_id = ? ORDER BY updated_at DESC')
		.all(userId) as { id: string; name: string; owner_id: string; created_at: number; updated_at: number }[]
	const shared = db
		.prepare(
			`SELECT p.id, p.name, p.owner_id, p.created_at, p.updated_at, s.can_edit
       FROM pages p JOIN page_shares s ON p.id = s.page_id
       WHERE s.user_id = ? ORDER BY p.updated_at DESC`
		)
		.all(userId) as {
		id: string
		name: string
		owner_id: string
		created_at: number
		updated_at: number
		can_edit: number
	}[]
	res.json({
		owned: owned.map((p) => ({ ...p, isOwner: true, canEdit: true })),
		shared: shared.map((p) => ({ ...p, isOwner: false, canEdit: p.can_edit === 1 })),
	})
})

// Create a page
router.post('/', (req, res) => {
	const { name } = req.body as { name?: string }
	if (!name?.trim()) {
		res.status(400).json({ error: 'name required' })
		return
	}
	const now = Date.now()
	const id = randomUUID()
	db.prepare('INSERT INTO pages (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
		id,
		req.user!.id,
		name.trim(),
		now,
		now
	)
	// Create empty snapshot placeholder
	db.prepare('INSERT INTO page_snapshots (page_id, snapshot, updated_at) VALUES (?, ?, ?)').run(id, '{}', now)
	res.status(201).json({ id, name: name.trim(), isOwner: true, canEdit: true })
})

// Rename a page (owner only)
router.patch('/:id', (req, res) => {
	const { name } = req.body as { name?: string }
	if (!name?.trim()) {
		res.status(400).json({ error: 'name required' })
		return
	}
	const info = db
		.prepare('UPDATE pages SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
		.run(name.trim(), Date.now(), req.params.id, req.user!.id)
	if (info.changes === 0) {
		res.status(403).json({ error: 'Not found or not owner' })
		return
	}
	res.json({ ok: true })
})

// Delete a page (owner only)
router.delete('/:id', (req, res) => {
	const info = db
		.prepare('DELETE FROM pages WHERE id = ? AND owner_id = ?')
		.run(req.params.id, req.user!.id)
	if (info.changes === 0) {
		res.status(403).json({ error: 'Not found or not owner' })
		return
	}
	res.json({ ok: true })
})

// List shares for a page
router.get('/:id/shares', (req, res) => {
	const { allowed } = canAccess(req.user!.id, req.params.id)
	if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const shares = db
		.prepare(
			`SELECT u.id, u.username, s.can_edit
       FROM page_shares s JOIN users u ON s.user_id = u.id
       WHERE s.page_id = ?`
		)
		.all(req.params.id)
	res.json(shares)
})

// Add/update a share (owner only)
router.post('/:id/shares', (req, res) => {
	const isOwner = db
		.prepare('SELECT 1 FROM pages WHERE id = ? AND owner_id = ?')
		.get(req.params.id, req.user!.id)
	if (!isOwner) { res.status(403).json({ error: 'Forbidden' }); return }

	const { userId, canEdit = true } = req.body as { userId?: string; canEdit?: boolean }
	if (!userId) { res.status(400).json({ error: 'userId required' }); return }

	db.prepare(
		'INSERT INTO page_shares (page_id, user_id, can_edit) VALUES (?, ?, ?) ON CONFLICT(page_id, user_id) DO UPDATE SET can_edit = excluded.can_edit'
	).run(req.params.id, userId, canEdit ? 1 : 0)
	res.json({ ok: true })
})

// Remove a share (owner only)
router.delete('/:id/shares/:userId', (req, res) => {
	const isOwner = db
		.prepare('SELECT 1 FROM pages WHERE id = ? AND owner_id = ?')
		.get(req.params.id, req.user!.id)
	if (!isOwner) { res.status(403).json({ error: 'Forbidden' }); return }
	db.prepare('DELETE FROM page_shares WHERE page_id = ? AND user_id = ?').run(req.params.id, req.params.userId)
	res.json({ ok: true })
})

export default router
