import { Router } from 'express'
import { db } from '../db/db.js'
import { authMiddleware } from '../middleware/auth.js'
import { decrypt, encrypt, maskKey } from '../lib/crypto.js'

const router = Router()
router.use(authMiddleware)

router.get('/', (req, res) => {
	const row = db
		.prepare('SELECT openai_key, anthropic_key, google_key FROM user_api_keys WHERE user_id = ?')
		.get(req.user!.id) as
		| { openai_key: string | null; anthropic_key: string | null; google_key: string | null }
		| undefined

	res.json({
		openai: maskKey(row?.openai_key),
		anthropic: maskKey(row?.anthropic_key),
		google: maskKey(row?.google_key),
	})
})

router.put('/', (req, res) => {
	const { openai, anthropic, google } = req.body as {
		openai?: string
		anthropic?: string
		google?: string
	}

	// Preserve existing keys if field is left blank
	const existing = db
		.prepare('SELECT openai_key, anthropic_key, google_key FROM user_api_keys WHERE user_id = ?')
		.get(req.user!.id) as
		| { openai_key: string | null; anthropic_key: string | null; google_key: string | null }
		| undefined

	const newOpenai = openai?.trim() ? encrypt(openai.trim()) : existing?.openai_key ?? null
	const newAnthropic = anthropic?.trim() ? encrypt(anthropic.trim()) : existing?.anthropic_key ?? null
	const newGoogle = google?.trim() ? encrypt(google.trim()) : existing?.google_key ?? null

	db.prepare(`
		INSERT INTO user_api_keys (user_id, openai_key, anthropic_key, google_key, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			openai_key    = excluded.openai_key,
			anthropic_key = excluded.anthropic_key,
			google_key    = excluded.google_key,
			updated_at    = excluded.updated_at
	`).run(req.user!.id, newOpenai, newAnthropic, newGoogle, Date.now())

	res.json({ ok: true })
})

/** Used internally by stream route to get decrypted keys for a user */
export function getUserKeys(userId: string): { openai: string; anthropic: string; google: string } {
	const row = db
		.prepare('SELECT openai_key, anthropic_key, google_key FROM user_api_keys WHERE user_id = ?')
		.get(userId) as
		| { openai_key: string | null; anthropic_key: string | null; google_key: string | null }
		| undefined

	const safe = (val: string | null | undefined): string => {
		if (!val) return ''
		try { return decrypt(val) } catch { return '' }
	}

	return {
		openai: safe(row?.openai_key),
		anthropic: safe(row?.anthropic_key),
		google: safe(row?.google_key),
	}
}

export default router
