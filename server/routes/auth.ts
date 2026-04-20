import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { db } from '../db/db.js'
import {
	AuthUser,
	signAccessToken,
	signRefreshToken,
	verifyRefreshToken,
} from '../middleware/auth.js'

const router = Router()

const COOKIE_OPTS = {
	httpOnly: true,
	sameSite: 'strict' as const,
	secure: process.env.NODE_ENV === 'production',
	maxAge: 7 * 24 * 60 * 60 * 1000,
}

router.post('/login', async (req, res) => {
	const { username, password } = req.body as { username?: string; password?: string }
	if (!username || !password) {
		res.status(400).json({ error: 'username and password required' })
		return
	}

	const row = db.prepare('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?').get(username) as
		| { id: string; username: string; password_hash: string; is_admin: number }
		| undefined

	if (!row || !(await bcrypt.compare(password, row.password_hash))) {
		res.status(401).json({ error: 'Invalid credentials' })
		return
	}

	const user: AuthUser = { id: row.id, username: row.username, isAdmin: row.is_admin === 1 }
	const accessToken = signAccessToken(user)
	const refreshToken = signRefreshToken(user)

	res.cookie('refreshToken', refreshToken, COOKIE_OPTS)
	res.json({ accessToken, user })
})

router.get('/me', (req, res) => {
	const token = req.cookies?.refreshToken as string | undefined
	if (!token) {
		res.status(401).json({ error: 'No session' })
		return
	}
	const user = verifyRefreshToken(token)
	if (!user) {
		res.status(401).json({ error: 'Session expired' })
		return
	}

	// Verify user still exists in db
	const row = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id)
	if (!row) {
		res.clearCookie('refreshToken')
		res.status(401).json({ error: 'User not found' })
		return
	}

	const accessToken = signAccessToken(user)
	res.json({ accessToken, user })
})

router.post('/logout', (_req, res) => {
	res.clearCookie('refreshToken')
	res.json({ ok: true })
})

export default router
