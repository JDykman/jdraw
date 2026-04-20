import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import express from 'express'
import { createServer } from 'http'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { db } from './db/db.js'
import { authMiddleware } from './middleware/auth.js'
import agentStateRouter from './routes/agentState.js'
import authRouter from './routes/auth.js'
import keysRouter from './routes/keys.js'
import pagesRouter from './routes/pages.js'
import streamRouter from './routes/stream.js'
import usersRouter from './routes/users.js'
import { attachWebSocketHandler } from './sync/wsHandler.js'
import { persistAllRooms } from './sync/roomManager.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT ?? 3001)
const IS_PROD = process.env.NODE_ENV === 'production'

async function bootstrapAdmin() {
	const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n
	if (count > 0) return

	const adminUser = process.env.ADMIN_USERNAME ?? 'admin'
	const adminPass = process.env.ADMIN_PASSWORD ?? 'changeme'
	const hash = await bcrypt.hash(adminPass, 12)
	db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)').run(
		randomUUID(),
		adminUser,
		hash,
		Date.now()
	)
	console.log(`Admin account created: ${adminUser} (set ADMIN_PASSWORD env var to change)`)
}

if (process.env.NODE_ENV === 'production') {
	const required = ['KEY_ENCRYPTION_SECRET', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']
	const missing = required.filter((k) => !process.env[k])
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`)
}

await bootstrapAdmin()

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(cookieParser())

app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/pages', pagesRouter)
app.use('/api/pages', agentStateRouter)
app.use('/api/keys', keysRouter)
app.use('/api/stream', authMiddleware, streamRouter)
// Keep /stream path for now (client still uses it; updated in step 4)
app.use('/stream', authMiddleware, streamRouter)

if (IS_PROD) {
	const distPath = join(__dirname, '..', 'dist')
	app.use(express.static(distPath))
	app.get('/:path*', (_req, res) => {
		res.sendFile(join(distPath, 'index.html'))
	})
}

const httpServer = createServer(app)
attachWebSocketHandler(httpServer)

process.on('SIGTERM', () => {
	persistAllRooms()
	db.close()
	httpServer.close(() => process.exit(0))
})

httpServer.listen(PORT, () => {
	console.log(`jdraw server running on http://localhost:${PORT}`)
})

export { httpServer }
