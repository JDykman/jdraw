import { Router } from 'express'
import { db } from '../db/db.js'
import { authMiddleware } from '../middleware/auth.js'
import { canAccess } from './pages.js'

const router = Router()
router.use(authMiddleware)

router.get('/:id/agent-state', (req, res) => {
	const { allowed } = canAccess(req.user!.id, req.params.id)
	if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return }

	const row = db
		.prepare('SELECT state_json FROM agent_state WHERE page_id = ? AND user_id = ?')
		.get(req.params.id, req.user!.id) as { state_json: string } | undefined

	if (!row) { res.status(204).end(); return }
	res.json(JSON.parse(row.state_json))
})

router.put('/:id/agent-state', (req, res) => {
	const { allowed } = canAccess(req.user!.id, req.params.id)
	if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return }

	db.prepare(
		`INSERT INTO agent_state (page_id, user_id, state_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(page_id, user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
	).run(req.params.id, req.user!.id, JSON.stringify(req.body), Date.now())
	res.json({ ok: true })
})

export default router
