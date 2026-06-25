import { IncomingMessage, Server } from 'http'
import { WebSocketServer } from 'ws'
import { AuthUser, verifyAccessToken, verifyRefreshToken } from '../middleware/auth.js'
import { canAccess } from '../routes/pages.js'
import { getOrCreateRoom, recordConnection, recordDisconnection } from './roomManager.js'

function parsePageId(url: string | undefined): string | null {
	if (!url) return null
	const match = url.match(/^\/ws\/pages\/([^/?]+)/)
	return match ? match[1] : null
}

function parseToken(url: string | undefined): string | null {
	if (!url) return null
	const u = new URL(url, 'http://localhost')
	return u.searchParams.get('token')
}

function parseSessionId(url: string | undefined): string | null {
	if (!url) return null
	const u = new URL(url, 'http://localhost')
	return u.searchParams.get('sessionId')
}

function parseCookies(header: string | undefined): Record<string, string> {
	if (!header) return {}
	return Object.fromEntries(
		header.split(';').flatMap((part) => {
			const [rawName, ...rawValue] = part.trim().split('=')
			if (!rawName || rawValue.length === 0) return []
			const value = rawValue.join('=')
			try {
				return [[rawName, decodeURIComponent(value)]]
			} catch {
				return [[rawName, value]]
			}
		})
	)
}

function authenticateUpgrade(req: IncomingMessage): AuthUser | null {
	const accessToken = parseToken(req.url)
	const accessUser = accessToken ? verifyAccessToken(accessToken) : null
	if (accessUser) return accessUser

	const refreshToken = parseCookies(req.headers.cookie).refreshToken
	return refreshToken ? verifyRefreshToken(refreshToken) : null
}

export function attachWebSocketHandler(httpServer: Server) {
	const wss = new WebSocketServer({ noServer: true })

	httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
		const pageId = parsePageId(req.url)
		const sessionId = parseSessionId(req.url)

		if (!pageId || !sessionId) {
			socket.destroy()
			return
		}

		const user = authenticateUpgrade(req)
		if (!user) {
			socket.destroy()
			return
		}

		const { allowed, canEdit } = canAccess(user.id, pageId)
		if (!allowed) {
			socket.destroy()
			return
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			const room = getOrCreateRoom(pageId)
			let didRecordDisconnection = false

			room.handleSocketConnect({
				sessionId,
				socket: ws as any,
				isReadonly: !canEdit,
			})

			recordConnection(pageId)

			const recordSocketDisconnection = () => {
				if (didRecordDisconnection) return
				didRecordDisconnection = true
				recordDisconnection(pageId)
			}

			ws.on('close', recordSocketDisconnection)
			ws.on('error', recordSocketDisconnection)
		})
	})
}
