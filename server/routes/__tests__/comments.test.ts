import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { after, before, describe, it } from 'node:test'
import { createPage, createUser, db } from '../../sync/__tests__/testDb.js'

const { default: commentsRouter, notificationsRouter } = await import('../comments.js')
const { signAccessToken } = await import('../../middleware/auth.js')
const rm = await import('../../sync/roomManager.js')
const { getTlsyncProtocolVersion } = (await import('@tldraw/sync-core')) as unknown as { getTlsyncProtocolVersion(): number }

const app = express()
app.use(express.json())
app.use('/api/pages', commentsRouter)
app.use('/api/notifications', notificationsRouter)
const httpServer = createServer(app)

before(() => new Promise<void>((resolve) => httpServer.listen(0, resolve)))
after(() => {
	rm.shutdownRooms()
	httpServer.close()
})

function tokenFor(id: string, username: string) {
	return signAccessToken({ id, username, isAdmin: false })
}

async function call(token: string, method: string, path: string, body?: unknown) {
	const { port } = httpServer.address() as AddressInfo
	const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	})
	return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

const ownerId = createUser('cm-owner')
const editorId = createUser('cm-editor')
const viewerId = createUser('cm-viewer')
const strangerId = createUser('cm-stranger')
const owner = tokenFor(ownerId, 'cm-owner')
const editor = tokenFor(editorId, 'cm-editor')
const viewer = tokenFor(viewerId, 'cm-viewer')
const stranger = tokenFor(strangerId, 'cm-stranger')

function sharedPage() {
	const pageId = createPage(ownerId, '{}')
	db.prepare('INSERT INTO page_shares (page_id, user_id, can_edit) VALUES (?, ?, 1)').run(pageId, editorId)
	db.prepare('INSERT INTO page_shares (page_id, user_id, can_edit) VALUES (?, ?, 0)').run(pageId, viewerId)
	return pageId
}

describe('comment permissions', () => {
	const pageId = sharedPage()

	it('requires page access, but read-only shares can comment', async () => {
		assert.equal((await call(stranger, 'GET', `/pages/${pageId}/comments`)).status, 403)
		assert.equal((await call(stranger, 'POST', `/pages/${pageId}/comments/threads`, { body: 'hi', anchorX: 1, anchorY: 2 })).status, 403)

		const created = await call(viewer, 'POST', `/pages/${pageId}/comments/threads`, { body: 'Looks off', anchorX: 10, anchorY: 20 })
		assert.equal(created.status, 201)
		assert.equal(created.body.shapeId, null)
		assert.equal(created.body.lastX, 10, 'point threads remember their position')
		assert.equal(created.body.comments.length, 1)
		assert.equal(created.body.comments[0].authorName, 'cm-viewer')

		const list = await call(viewer, 'GET', `/pages/${pageId}/comments`)
		assert.equal(list.status, 200)
		assert.equal(list.body.canEdit, false)
		assert.equal(list.body.threads.length, 1)
	})

	it('validates input', async () => {
		assert.equal((await call(editor, 'POST', `/pages/${pageId}/comments/threads`, { body: '   ', anchorX: 1, anchorY: 1 })).status, 400)
		assert.equal((await call(editor, 'POST', `/pages/${pageId}/comments/threads`, { body: 'x', anchorX: 'a', anchorY: 1 })).status, 400)
		assert.equal((await call(editor, 'POST', `/pages/${pageId}/comments/threads`, { body: 'x'.repeat(4001), anchorX: 1, anchorY: 1 })).status, 400)
	})

	it('lets authors edit and delete their own comments and the owner delete anything', async () => {
		const thread = (await call(editor, 'POST', `/pages/${pageId}/comments/threads`, { body: 'first', shapeId: 'shape:a', anchorX: 0.5, anchorY: 0.5 })).body
		const reply = (await call(viewer, 'POST', `/pages/${pageId}/comments/threads/${thread.id}/comments`, { body: 'reply' })).body
		assert.equal(reply.threadId, thread.id)

		assert.equal((await call(editor, 'PATCH', `/pages/${pageId}/comments/${reply.id}`, { body: 'nope' })).status, 403)
		assert.equal((await call(owner, 'PATCH', `/pages/${pageId}/comments/${reply.id}`, { body: 'nope' })).status, 403, 'owner cannot edit others')
		const edited = await call(viewer, 'PATCH', `/pages/${pageId}/comments/${reply.id}`, { body: 'reply (edited)' })
		assert.equal(edited.status, 200)
		assert.equal(edited.body.body, 'reply (edited)')
		assert.equal(typeof edited.body.editedAt, 'number')

		assert.equal((await call(editor, 'DELETE', `/pages/${pageId}/comments/${reply.id}`)).status, 403)
		assert.equal((await call(owner, 'DELETE', `/pages/${pageId}/comments/${reply.id}`)).status, 200)

		assert.equal((await call(editor, 'DELETE', `/pages/${pageId}/comments/threads/${thread.id}`)).status, 403, 'thread delete is owner only')
		// Deleting the last comment removes the thread
		const gone = await call(editor, 'DELETE', `/pages/${pageId}/comments/${thread.comments[0].id}`)
		assert.equal(gone.body.threadDeleted, true)
		assert.equal((await call(editor, 'GET', `/pages/${pageId}/comments`)).body.threads.some((t: any) => t.id === thread.id), false)
	})

	it('anyone with access can resolve and reopen, and update the fallback position', async () => {
		const thread = (await call(owner, 'POST', `/pages/${pageId}/comments/threads`, { body: 'q', shapeId: 'shape:b', anchorX: 0, anchorY: 0 })).body
		const resolved = await call(viewer, 'PATCH', `/pages/${pageId}/comments/threads/${thread.id}`, { resolved: true })
		assert.equal(resolved.status, 200)
		assert.equal(typeof resolved.body.resolvedAt, 'number')
		assert.equal(resolved.body.resolvedByName, 'cm-viewer')
		const reopened = await call(editor, 'PATCH', `/pages/${pageId}/comments/threads/${thread.id}`, { resolved: false, lastX: 5, lastY: 6 })
		assert.equal(reopened.body.resolvedAt, null)
		assert.equal(reopened.body.lastX, 5)
		assert.equal((await call(owner, 'DELETE', `/pages/${pageId}/comments/threads/${thread.id}`)).status, 200)
	})
})

describe('mentions', () => {
	const pageId = sharedPage()

	it('resolve only to users with access and the autocomplete list flags the rest', async () => {
		const list = await call(owner, 'GET', `/pages/${pageId}/comments`)
		const users = Object.fromEntries(list.body.users.map((u: any) => [u.username, u.hasAccess]))
		assert.equal(users['cm-owner'], true)
		assert.equal(users['cm-viewer'], true)
		assert.equal(users['cm-stranger'], false)

		const thread = (
			await call(owner, 'POST', `/pages/${pageId}/comments/threads`, {
				body: 'Hey @cm-viewer and @CM-EDITOR, also @cm-stranger! and @nobody.',
				anchorX: 1,
				anchorY: 1,
			})
		).body
		assert.deepEqual([...thread.comments[0].mentions].sort(), [editorId, viewerId].sort())

		// Editing re-resolves mentions
		const edited = await call(owner, 'PATCH', `/pages/${pageId}/comments/${thread.comments[0].id}`, { body: 'just @cm-editor now' })
		assert.deepEqual(edited.body.mentions, [editorId])
	})
})

describe('unread counts', () => {
	const pageId = sharedPage()
	const otherPage = sharedPage()

	it('count other people\'s comments since the last read, mentions included', async () => {
		const before = await call(viewer, 'GET', '/notifications')
		assert.equal(before.body.pages[pageId], undefined)

		const thread = (await call(owner, 'POST', `/pages/${pageId}/comments/threads`, { body: 'ping @cm-viewer', anchorX: 1, anchorY: 1 })).body
		await call(owner, 'POST', `/pages/${pageId}/comments/threads/${thread.id}/comments`, { body: 'more' })
		await call(viewer, 'POST', `/pages/${pageId}/comments/threads/${thread.id}/comments`, { body: 'my own reply' })
		await call(editor, 'POST', `/pages/${otherPage}/comments/threads`, { body: 'elsewhere @cm-viewer', anchorX: 1, anchorY: 1 })

		const counts = (await call(viewer, 'GET', '/notifications')).body.pages
		assert.deepEqual(counts[pageId], { unread: 2, mentions: 1 })
		assert.deepEqual(counts[otherPage], { unread: 1, mentions: 1 })
		assert.equal((await call(stranger, 'GET', '/notifications')).body.pages[pageId], undefined)
		assert.deepEqual((await call(owner, 'GET', '/notifications')).body.pages[pageId], { unread: 1, mentions: 0 })

		assert.equal((await call(viewer, 'POST', `/pages/${pageId}/comments/read`)).status, 200)
		const after = (await call(viewer, 'GET', '/notifications')).body.pages
		assert.equal(after[pageId], undefined)
		assert.deepEqual(after[otherPage], { unread: 1, mentions: 1 }, 'other pages unaffected')

		await call(owner, 'POST', `/pages/${pageId}/comments/threads/${thread.id}/comments`, { body: 'again' })
		assert.deepEqual((await call(viewer, 'GET', '/notifications')).body.pages[pageId], { unread: 1, mentions: 0 })
	})

	it('cascade with the page', async () => {
		const pageId = sharedPage()
		const thread = (await call(owner, 'POST', `/pages/${pageId}/comments/threads`, { body: 'bye @cm-viewer', anchorX: 1, anchorY: 1 })).body
		db.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
		assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comment_threads WHERE id = ?').get(thread.id) as { n: number }).n, 0)
		assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?').get(thread.id) as { n: number }).n, 0)
		assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comment_mentions WHERE comment_id = ?').get(thread.comments[0].id) as { n: number }).n, 0)
	})
})

describe('realtime', () => {
	it('notifies connected sessions of the page after a mutation', async () => {
		const pageId = sharedPage()
		const room = rm.getOrCreateRoom(pageId)!
		const received: any[] = []
		const socket = { readyState: 1, send: (msg: string) => received.push(JSON.parse(msg)), close() {} }
		room.handleSocketConnect({ sessionId: 'c1', socket, meta: { userId: viewerId, canEdit: false } })
		room.handleSocketMessage(
			'c1',
			JSON.stringify({ type: 'connect', connectRequestId: 'r', schema: rm.schema.serialize(), protocolVersion: getTlsyncProtocolVersion(), lastServerClock: 0 })
		)
		received.length = 0

		await call(owner, 'POST', `/pages/${pageId}/comments/threads`, { body: 'live', anchorX: 1, anchorY: 1 })
		const custom = received.find((m) => m.type === 'custom')
		assert.ok(custom, 'session got a custom message')
		assert.deepEqual(custom.data, { type: 'comments-changed', pageId })
		rm.evictRoom(pageId)
	})
})
