import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { after, before, describe, it } from 'node:test'
import { createPage, createUser, db } from '../../sync/__tests__/testDb.js'

const { default: checkpointsRouter } = await import('../checkpoints.js')
const { signAccessToken } = await import('../../middleware/auth.js')
const rm = await import('../../sync/roomManager.js')

const app = express()
app.use(express.json())
app.use('/api/pages', checkpointsRouter)
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
	const r = await fetch(`http://127.0.0.1:${port}/api/pages${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	})
	return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

describe('checkpoint routes', () => {
	const ownerId = createUser('cp-owner')
	const editorId = createUser('cp-editor')
	const viewerId = createUser('cp-viewer')
	const strangerId = createUser('cp-stranger')
	const owner = tokenFor(ownerId, 'cp-owner')
	const editor = tokenFor(editorId, 'cp-editor')
	const viewer = tokenFor(viewerId, 'cp-viewer')
	const stranger = tokenFor(strangerId, 'cp-stranger')
	const pageId = createPage(ownerId, '{}')
	db.prepare('INSERT INTO page_shares (page_id, user_id, can_edit) VALUES (?, ?, 1)').run(pageId, editorId)
	db.prepare('INSERT INTO page_shares (page_id, user_id, can_edit) VALUES (?, ?, 0)').run(pageId, viewerId)

	it('requires page access', async () => {
		assert.equal((await call(stranger, 'GET', `/${pageId}/checkpoints`)).status, 403)
		assert.equal((await call(stranger, 'POST', `/${pageId}/checkpoints`, {})).status, 403)
		assert.equal((await call('bad-token', 'GET', `/${pageId}/checkpoints`)).status, 401)
	})

	it('lets editors save versions and read-only users only list them', async () => {
		const created = await call(editor, 'POST', `/${pageId}/checkpoints`, { label: '  First  ' })
		assert.equal(created.status, 201)
		assert.equal(created.body.label, 'First')
		assert.equal(created.body.kind, 'manual')
		assert.equal(created.body.createdByName, 'cp-editor')

		assert.equal((await call(viewer, 'POST', `/${pageId}/checkpoints`, {})).status, 403)
		assert.equal((await call(viewer, 'POST', `/${pageId}/checkpoints/${created.body.id}/restore`)).status, 403)

		const list = await call(viewer, 'GET', `/${pageId}/checkpoints`)
		assert.equal(list.status, 200)
		assert.equal(list.body.canEdit, false)
		assert.equal(list.body.isOwner, false)
		assert.equal(list.body.loadFailed, false)
		assert.equal(list.body.checkpoints.length, 1)
		assert.equal(list.body.checkpoints[0].createdByName, 'cp-editor')
		assert.equal('snapshot' in list.body.checkpoints[0], false, 'list is metadata only')

		const one = await call(viewer, 'GET', `/${pageId}/checkpoints/${created.body.id}`)
		assert.equal(one.status, 200)
		assert.equal(typeof one.body.snapshot, 'string')
		assert.equal((await call(viewer, 'GET', `/${pageId}/checkpoints/missing`)).status, 404)

		const restored = await call(editor, 'POST', `/${pageId}/checkpoints/${created.body.id}/restore`)
		assert.equal(restored.status, 200)
		assert.equal(restored.body.preRestore.kind, 'pre-restore')
	})

	it('only lets the owner delete, and only manual or quarantine checkpoints', async () => {
		const list = await call(owner, 'GET', `/${pageId}/checkpoints`)
		const manual = list.body.checkpoints.find((c: any) => c.kind === 'manual')
		const pre = list.body.checkpoints.find((c: any) => c.kind === 'pre-restore')
		assert.equal((await call(editor, 'DELETE', `/${pageId}/checkpoints/${manual.id}`)).status, 403)
		assert.equal((await call(owner, 'DELETE', `/${pageId}/checkpoints/${pre.id}`)).status, 400)
		assert.equal((await call(owner, 'DELETE', `/${pageId}/checkpoints/${manual.id}`)).status, 200)
		assert.equal((await call(owner, 'DELETE', `/${pageId}/checkpoints/${manual.id}`)).status, 404)
	})

	it('reports a failed page and refuses to checkpoint it', async () => {
		const failedId = createPage(ownerId, 'garbage')
		assert.equal(rm.getOrCreateRoom(failedId), null)
		const list = await call(owner, 'GET', `/${failedId}/checkpoints`)
		assert.equal(list.body.loadFailed, true)
		assert.equal(list.body.checkpoints[0].kind, 'quarantine')
		assert.equal((await call(owner, 'POST', `/${failedId}/checkpoints`, {})).status, 409)
		const restore = await call(owner, 'POST', `/${failedId}/checkpoints/${list.body.checkpoints[0].id}/restore`)
		assert.equal(restore.status, 400)
	})
})
