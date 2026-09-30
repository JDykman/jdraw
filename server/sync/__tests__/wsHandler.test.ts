import assert from 'node:assert/strict'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { after, before, describe, it } from 'node:test'
import WebSocket from 'ws'
import { TLSyncErrorCloseEventCode } from '@tldraw/sync-core'
import { createPage, createUser } from './testDb.js'

const { attachWebSocketHandler } = await import('../wsHandler.js')
const { signAccessToken } = await import('../../middleware/auth.js')
const rm = await import('../roomManager.js')

const httpServer = createServer()
attachWebSocketHandler(httpServer)

before(() => new Promise<void>((resolve) => httpServer.listen(0, resolve)))
after(() => {
	rm.shutdownRooms()
	httpServer.close()
})

function connect(pageId: string, token: string) {
	const { port } = httpServer.address() as AddressInfo
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pages/${pageId}?sessionId=s1&token=${encodeURIComponent(token)}`)
	return new Promise<{ opened: boolean; code: number; reason: string }>((resolve) => {
		let opened = false
		ws.on('open', () => {
			opened = true
			// A healthy room keeps the socket open; close it ourselves after the first server message
			ws.once('message', () => ws.close())
			ws.send(JSON.stringify({ type: 'ping' }))
		})
		ws.on('close', (code, reason) => resolve({ opened, code, reason: reason.toString() }))
		ws.on('error', () => resolve({ opened, code: -1, reason: 'error' }))
	})
}

describe('websocket upgrade', () => {
	const ownerId = createUser()
	const token = signAccessToken({ id: ownerId, username: 'owner', isAdmin: false })

	it('rejects a page whose snapshot failed to load with the fatal close code', async () => {
		const pageId = createPage(ownerId, 'not json at all')
		const result = await connect(pageId, token)
		assert.equal(result.opened, true)
		assert.equal(result.code, TLSyncErrorCloseEventCode)
		assert.equal(result.reason, 'snapshot-load-failed')
		assert.equal(rm.getActiveRoom(pageId), null)
	})

	it('keeps a healthy page open', async () => {
		const pageId = createPage(ownerId, '{}')
		const result = await connect(pageId, token)
		assert.equal(result.opened, true)
		assert.notEqual(result.code, TLSyncErrorCloseEventCode)
		assert.ok(rm.getActiveRoom(pageId))
	})
})
