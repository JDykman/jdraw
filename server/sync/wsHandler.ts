import { IncomingMessage, Server } from 'http'
import { randomUUID } from 'crypto'
import { WebSocketServer } from 'ws'
import { verifyAccessToken } from '../middleware/auth.js'
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

export function attachWebSocketHandler(httpServer: Server) {
	const wss = new WebSocketServer({ noServer: true })

	httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
		const pageId = parsePageId(req.url)
		const token = parseToken(req.url)

		if (!pageId || !token) {
			socket.destroy()
			return
		}

		const user = verifyAccessToken(token)
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
			const sessionId = randomUUID()
			const room = getOrCreateRoom(pageId)

			room.handleSocketConnect({
				sessionId,
				socket: ws as any,
				isReadonly: !canEdit,
			})

			recordConnection(pageId)

			ws.on('close', () => {
				recordDisconnection(pageId)
			})

			ws.on('error', () => {
				recordDisconnection(pageId)
			})
		})
	})
}
