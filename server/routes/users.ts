import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../db/db.js'
import { adminOnly, authMiddleware } from '../middleware/auth.js'

const router = Router()
router.use(authMiddleware, adminOnly)

router.get('/', (_req, res) => {
	const users = db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at').all()
	res.json(users)
})

router.post('/', async (req, res) => {
	const { username, password } = req.body as { username?: string; password?: string }
	if (!username || !password) {
		res.status(400).json({ error: 'username and password required' })
		return
	}
	const hash = await bcrypt.hash(password, 12)
	try {
		db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)').run(
			randomUUID(),
			username,
			hash,
			Date.now()
		)
		res.status(201).json({ ok: true })
	} catch {
		res.status(409).json({ error: 'Username already taken' })
	}
})

router.patch('/:id', async (req, res) => {
	const { password } = req.body as { password?: string }
	if (!password) {
		res.status(400).json({ error: 'password required' })
		return
	}
	const hash = await bcrypt.hash(password, 12)
	const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id)
	if (info.changes === 0) {
		res.status(404).json({ error: 'User not found' })
		return
	}
	res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
	db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
	res.json({ ok: true })
})

export default router
