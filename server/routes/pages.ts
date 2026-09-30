import { randomUUID } from 'crypto'
import express, { Router } from 'express'
import { getUnreadCounts } from '../db/comments.js'
import { db } from '../db/db.js'
import { authMiddleware } from '../middleware/auth.js'
import { getPageSnapshotJson } from '../sync/roomManager.js'

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

interface PageRow {
	id: string
	name: string
	owner_id: string
	owner_name: string
	created_at: number
	updated_at: number
	last_edited_at: number | null
	last_edited_by: string | null
	last_edited_by_name: string | null
	last_viewed_at: number | null
	pinned_at: number | null
	thumbnail_updated_at: number | null
	can_edit: number
	tags: string | null
}

// List pages accessible to the current user, with the metadata the homepage needs
router.get('/', (req, res) => {
	const userId = req.user!.id
	const rows = db
		.prepare(
			`SELECT p.id, p.name, p.owner_id, o.username AS owner_name, p.created_at, p.updated_at,
			        p.last_edited_at, p.last_edited_by, e.username AS last_edited_by_name,
			        v.last_viewed_at, pin.pinned_at, t.updated_at AS thumbnail_updated_at,
			        CASE WHEN p.owner_id = @userId THEN 1 ELSE s.can_edit END AS can_edit,
			        (SELECT group_concat(tag, char(31)) FROM page_tags WHERE page_id = p.id) AS tags
			 FROM pages p
			 JOIN users o ON o.id = p.owner_id
			 LEFT JOIN page_shares s ON s.page_id = p.id AND s.user_id = @userId
			 LEFT JOIN users e ON e.id = p.last_edited_by
			 LEFT JOIN page_views v ON v.page_id = p.id AND v.user_id = @userId
			 LEFT JOIN page_pins pin ON pin.page_id = p.id AND pin.user_id = @userId
			 LEFT JOIN page_thumbnails t ON t.page_id = p.id
			 WHERE p.owner_id = @userId OR s.user_id IS NOT NULL
			 ORDER BY COALESCE(p.last_edited_at, p.updated_at) DESC`
		)
		.all({ userId }) as PageRow[]
	const unread = getUnreadCounts(userId)
	const pages = rows.map((p) => ({
		id: p.id,
		name: p.name,
		ownerId: p.owner_id,
		ownerName: p.owner_name,
		isOwner: p.owner_id === userId,
		canEdit: p.can_edit === 1,
		createdAt: p.created_at,
		updatedAt: p.updated_at,
		lastEditedAt: p.last_edited_at,
		lastEditedById: p.last_edited_by,
		lastEditedByName: p.last_edited_by_name,
		lastViewedAt: p.last_viewed_at,
		pinned: p.pinned_at != null,
		thumbnailUpdatedAt: p.thumbnail_updated_at,
		tags: p.tags ? p.tags.split('\x1f').sort() : [],
		unreadComments: unread.get(p.id)?.unread ?? 0,
		unreadMentions: unread.get(p.id)?.mentions ?? 0,
	}))
	res.json({
		pages,
		// Kept for older clients
		owned: pages.filter((p) => p.isOwner),
		shared: pages.filter((p) => !p.isOwner),
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

const MAX_TAGS = 20
const MAX_TAG_LENGTH = 32

function normalizeTags(input: unknown): string[] | null {
	if (!Array.isArray(input)) return null
	const tags = new Set<string>()
	for (const raw of input) {
		if (typeof raw !== 'string') return null
		const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').slice(0, MAX_TAG_LENGTH)
		if (tag) tags.add(tag)
	}
	return [...tags].slice(0, MAX_TAGS)
}

// Replace a page's tags (anyone who can edit the page)
router.put('/:id/tags', (req, res) => {
	const { canEdit } = canAccess(req.user!.id, req.params.id)
	if (!canEdit) { res.status(403).json({ error: 'Forbidden' }); return }
	const tags = normalizeTags((req.body as { tags?: unknown }).tags)
	if (!tags) { res.status(400).json({ error: 'tags must be an array of strings' }); return }
	db.transaction(() => {
		db.prepare('DELETE FROM page_tags WHERE page_id = ?').run(req.params.id)
		const insert = db.prepare('INSERT INTO page_tags (page_id, tag) VALUES (?, ?)')
		for (const tag of tags) insert.run(req.params.id, tag)
	})()
	res.json({ tags })
})

// Pin / unpin a page for the current user
router.put('/:id/pin', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	db.prepare('INSERT OR IGNORE INTO page_pins (user_id, page_id, pinned_at) VALUES (?, ?, ?)').run(
		req.user!.id,
		req.params.id,
		Date.now()
	)
	res.json({ ok: true })
})

router.delete('/:id/pin', (req, res) => {
	db.prepare('DELETE FROM page_pins WHERE user_id = ? AND page_id = ?').run(req.user!.id, req.params.id)
	res.json({ ok: true })
})

// Record that the current user opened a page (drives the "edited since you looked" badge)
router.post('/:id/view', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	db.prepare(
		`INSERT INTO page_views (user_id, page_id, last_viewed_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, page_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at`
	).run(req.user!.id, req.params.id, Date.now())
	res.json({ ok: true })
})

router.get('/:id/thumbnail', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const row = db.prepare('SELECT png FROM page_thumbnails WHERE page_id = ?').get(req.params.id) as
		| { png: Buffer }
		| undefined
	if (!row) { res.status(404).end(); return }
	res.type('image/png').set('Cache-Control', 'private, max-age=31536000, immutable').send(row.png)
})

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

router.put('/:id/thumbnail', express.raw({ type: 'image/png', limit: '1mb' }), (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const body = req.body as Buffer
	if (!Buffer.isBuffer(body) || !body.subarray(0, 8).equals(PNG_SIGNATURE)) {
		res.status(400).json({ error: 'PNG body required' })
		return
	}
	const now = Date.now()
	db.prepare(
		`INSERT INTO page_thumbnails (page_id, png, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(page_id) DO UPDATE SET png = excluded.png, updated_at = excluded.updated_at`
	).run(req.params.id, body, now)
	res.json({ updatedAt: now })
})

// Clear a thumbnail (the page was emptied)
router.delete('/:id/thumbnail', (req, res) => {
	if (!canAccess(req.user!.id, req.params.id).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	db.prepare('DELETE FROM page_thumbnails WHERE page_id = ?').run(req.params.id)
	res.json({ ok: true })
})

// Copy a page (content, tags, thumbnail) into a new page owned by the current user
router.post('/:id/duplicate', (req, res) => {
	const userId = req.user!.id
	const sourceId = req.params.id
	if (!canAccess(userId, sourceId).allowed) { res.status(403).json({ error: 'Forbidden' }); return }
	const source = db.prepare('SELECT name FROM pages WHERE id = ?').get(sourceId) as { name: string } | undefined
	if (!source) { res.status(404).json({ error: 'Not found' }); return }
	const requested = (req.body as { name?: string } | undefined)?.name?.trim()
	const name = requested || `${source.name} (copy)`
	const snapshot = getPageSnapshotJson(sourceId) ?? '{}'
	const id = randomUUID()
	const now = Date.now()
	db.transaction(() => {
		db.prepare('INSERT INTO pages (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
			id, userId, name, now, now
		)
		db.prepare('INSERT INTO page_snapshots (page_id, snapshot, updated_at) VALUES (?, ?, ?)').run(id, snapshot, now)
		db.prepare('INSERT INTO page_tags (page_id, tag) SELECT ?, tag FROM page_tags WHERE page_id = ?').run(id, sourceId)
		db.prepare(
			'INSERT INTO page_thumbnails (page_id, png, updated_at) SELECT ?, png, ? FROM page_thumbnails WHERE page_id = ?'
		).run(id, now, sourceId)
	})()
	res.status(201).json({ id, name })
})

export default router
