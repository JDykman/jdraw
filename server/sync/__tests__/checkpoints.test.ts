import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createPage, createUser, db, geoShape, getStoredSnapshot, listCheckpointRows, tableShape } from './testDb.js'

const rm = await import('../roomManager.js')
// Not in the package's public typings, but exported at runtime
const { getTlsyncProtocolVersion } = (await import('@tldraw/sync-core')) as unknown as { getTlsyncProtocolVersion(): number }
const cp = await import('../checkpoints.js')
const dbcp = await import('../../db/checkpoints.js')

after(() => rm.shutdownRooms())

const DAY = 24 * 60 * 60 * 1000

function putShape(room: NonNullable<ReturnType<typeof rm.getActiveRoom>>, id: string, text = '') {
	room.storage.transaction((txn) => txn.set(id as any, geoShape(id, text) as any))
}

function shapeIds(json: string): string[] {
	const snapshot = JSON.parse(json)
	return snapshot.documents.map((d: any) => d.state.id).filter((id: string) => id.startsWith('shape:')).sort()
}

/** A snapshot JSON containing exactly the given shapes, built from a throwaway page. */
function snapshotWith(owner: string, ...ids: string[]): string {
	const pageId = createPage(owner, '{}')
	const room = rm.getOrCreateRoom(pageId)!
	for (const id of ids) putShape(room, id)
	const json = JSON.stringify(room.getCurrentSnapshot())
	rm.evictRoom(pageId)
	return json
}

/** Attach a fake, fully connected client session so broadcasts can be observed. */
function attachFakeClient(room: NonNullable<ReturnType<typeof rm.getActiveRoom>>, sessionId: string) {
	const received: any[] = []
	const socket = {
		readyState: 1,
		send: (msg: string) => received.push(JSON.parse(msg)),
		close: () => {
			socket.readyState = 3
		},
	}
	room.handleSocketConnect({ sessionId, socket, meta: { userId: 'u', canEdit: true } })
	room.handleSocketMessage(
		sessionId,
		JSON.stringify({
			type: 'connect',
			connectRequestId: 'r1',
			schema: rm.schema.serialize(),
			protocolVersion: getTlsyncProtocolVersion(),
			lastServerClock: 0,
		})
	)
	assert.equal(received.at(-1)?.type, 'connect', 'fake client should be connected')
	received.length = 0
	return { received, socket }
}

describe('auto checkpoints', () => {
	const owner = createUser()

	it('are only taken when the document clock advanced', () => {
		const pageId = createPage(owner, '{}')
		const room = rm.getOrCreateRoom(pageId)!
		assert.equal(rm.autoCheckpoint(pageId), false, 'nothing changed since load')
		putShape(room, 'shape:a')
		assert.equal(rm.autoCheckpoint(pageId), true)
		assert.equal(rm.autoCheckpoint(pageId), false, 'nothing changed since the last checkpoint')
		putShape(room, 'shape:b')
		assert.equal(rm.autoCheckpoint(pageId), true)

		const rows = listCheckpointRows(pageId)
		assert.equal(rows.length, 2)
		assert.deepEqual(rows.map((r) => r.kind), ['auto', 'auto'])
		assert.deepEqual(shapeIds(rows[1].snapshot), ['shape:a', 'shape:b'])
		assert.equal(rows[1].doc_clock, room.getCurrentDocumentClock())
		rm.evictRoom(pageId)
		assert.equal(listCheckpointRows(pageId).length, 2, 'eviction with no change adds nothing')
	})

	it('are taken on eviction when the document changed', () => {
		const pageId = createPage(owner, '{}')
		putShape(rm.getOrCreateRoom(pageId)!, 'shape:a')
		rm.evictRoom(pageId)
		const rows = listCheckpointRows(pageId)
		assert.equal(rows.length, 1)
		assert.equal(rows[0].kind, 'auto')
		assert.ok(getStoredSnapshot(pageId)?.includes('shape:a'), 'eviction also persisted')
	})

	it('a manual checkpoint resets the auto throttle', () => {
		const pageId = createPage(owner, '{}')
		putShape(rm.getOrCreateRoom(pageId)!, 'shape:a')
		const manual = cp.captureCheckpoint(pageId, 'manual', { label: 'v1', createdBy: owner })
		assert.equal(manual?.kind, 'manual')
		assert.equal(rm.autoCheckpoint(pageId), false)
		rm.evictRoom(pageId)
		assert.deepEqual(listCheckpointRows(pageId).map((r) => [r.kind, r.label]), [['manual', 'v1']])
	})
})

describe('captureCheckpoint', () => {
	const owner = createUser()

	it('copies the stored snapshot when the room is not active', () => {
		const pageId = createPage(owner, snapshotWith(owner, 'shape:x'))
		const meta = cp.captureCheckpoint(pageId, 'manual', { createdBy: owner })
		assert.ok(meta)
		const rows = listCheckpointRows(pageId)
		assert.deepEqual(shapeIds(rows[0].snapshot), ['shape:x'])
		assert.equal(typeof rows[0].doc_clock, 'number')
		assert.equal(rows[0].created_by, owner)
	})

	it('works for an empty page and refuses a failed page', () => {
		assert.ok(cp.captureCheckpoint(createPage(owner, '{}'), 'manual'))
		const failed = createPage(owner, 'garbage')
		assert.equal(rm.getOrCreateRoom(failed), null)
		assert.equal(cp.captureCheckpoint(failed, 'manual'), null)
		assert.deepEqual(listCheckpointRows(failed).map((r) => r.kind), ['quarantine'])
	})
})

describe('retention sweep', () => {
	it('deletes only expired auto and pre-restore checkpoints', () => {
		const owner = createUser()
		const pageId = createPage(owner, '{}')
		const now = Date.now()
		const old = now - 31 * DAY
		const fresh = now - 29 * DAY
		for (const [kind, at] of [
			['auto', old],
			['pre-restore', old],
			['manual', old],
			['quarantine', old],
			['auto', fresh],
			['pre-restore', fresh],
		] as const) {
			dbcp.insertCheckpoint({ pageId, kind, snapshot: '{}', now: at })
		}
		assert.equal(dbcp.sweepExpiredCheckpoints(now), 2)
		assert.deepEqual(
			listCheckpointRows(pageId).map((r) => [r.kind, r.created_at === old ? 'old' : 'fresh']),
			[
				['manual', 'old'],
				['quarantine', 'old'],
				['auto', 'fresh'],
				['pre-restore', 'fresh'],
			]
		)
	})
})

describe('restoreCheckpoint', () => {
	const owner = createUser()

	it('replaces the stored row when the room is inactive and leaves a pre-restore checkpoint', () => {
		const pageId = createPage(owner, snapshotWith(owner, 'shape:current'))
		const target = dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: snapshotWith(owner, 'shape:old') })

		const result = cp.restoreCheckpoint(pageId, target.id, owner)
		assert.equal(result.ok, true)
		assert.deepEqual(shapeIds(getStoredSnapshot(pageId)!), ['shape:old'])
		const pre = listCheckpointRows(pageId).filter((r) => r.kind === 'pre-restore')
		assert.equal(pre.length, 1)
		assert.deepEqual(shapeIds(pre[0].snapshot), ['shape:current'])
		assert.equal(pre[0].created_by, owner)

		// Undo via the pre-restore checkpoint
		assert.equal(cp.restoreCheckpoint(pageId, pre[0].id, owner).ok, true)
		assert.deepEqual(shapeIds(getStoredSnapshot(pageId)!), ['shape:current'])
	})

	it('loads into the live room, broadcasts to connected clients and persists', async () => {
		const pageId = createPage(owner, '{}')
		const target = dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: snapshotWith(owner, 'shape:old') })
		const room = rm.getOrCreateRoom(pageId)!
		putShape(room, 'shape:current')
		const client = attachFakeClient(room, 'client-1')

		const result = cp.restoreCheckpoint(pageId, target.id, owner)
		assert.equal(result.ok, true)
		assert.deepEqual(shapeIds(JSON.stringify(room.getCurrentSnapshot())), ['shape:old'])
		assert.deepEqual(shapeIds(getStoredSnapshot(pageId)!), ['shape:old'], 'persisted immediately')
		assert.deepEqual(shapeIds(listCheckpointRows(pageId).find((r) => r.kind === 'pre-restore')!.snapshot), ['shape:current'])

		// The connected client received the restored document as a patch: old put, current removed.
		// Outgoing data events are batched, so give the room a tick to flush them.
		await new Promise((r) => setTimeout(r, 50))
		const patches = client.received.flatMap((m) => (m.type === 'data' ? m.data : [m])).filter((m) => m.type === 'patch')
		assert.ok(patches.length > 0, 'client got a patch')
		const diff = Object.assign({}, ...patches.map((p) => p.diff))
		assert.equal(diff['shape:old']?.[0], 'put')
		assert.equal(diff['shape:current']?.[0], 'remove')

		assert.equal(rm.autoCheckpoint(pageId), false, 'restored state counts as checkpointed')
		rm.evictRoom(pageId)
	})

	it('clears the failed-load state so the page loads again', () => {
		const pageId = createPage(owner, 'garbage')
		assert.equal(rm.getOrCreateRoom(pageId), null)
		const target = dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: snapshotWith(owner, 'shape:saved') })

		const result = cp.restoreCheckpoint(pageId, target.id, owner)
		assert.equal(result.ok, true)
		assert.equal(rm.isPageLoadFailed(pageId), false)
		assert.deepEqual(listCheckpointRows(pageId).map((r) => r.kind).sort(), ['manual', 'quarantine'], 'no pre-restore for a failed page')
		const room = rm.getOrCreateRoom(pageId)
		assert.ok(room)
		assert.deepEqual(shapeIds(JSON.stringify(room.getCurrentSnapshot())), ['shape:saved'])
		rm.evictRoom(pageId)
	})

	it('rejects quarantine, unknown and unloadable checkpoints without changing anything', () => {
		const stored = snapshotWith(owner, 'shape:current')
		const pageId = createPage(owner, stored)
		const quarantine = dbcp.insertCheckpoint({ pageId, kind: 'quarantine', snapshot: 'garbage' })
		const future = JSON.parse(snapshotWith(owner))
		future.schema.sequences['com.tldraw.shape.table'] = 99
		const unloadable = dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: JSON.stringify(future) })
		const notJson = dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: '{oops' })

		assert.deepEqual(cp.restoreCheckpoint(pageId, quarantine.id, owner), {
			ok: false,
			status: 400,
			error: 'Quarantined snapshots cannot be restored directly',
		})
		assert.equal(cp.restoreCheckpoint(pageId, 'nope', owner).ok, false)
		const r422 = cp.restoreCheckpoint(pageId, unloadable.id, owner)
		assert.equal(r422.ok === false && r422.status, 422)
		const r422b = cp.restoreCheckpoint(pageId, notJson.id, owner)
		assert.equal(r422b.ok === false && r422b.status, 422)

		assert.equal(getStoredSnapshot(pageId), stored)
		assert.equal(listCheckpointRows(pageId).some((r) => r.kind === 'pre-restore'), false)
	})

	it('migrates a checkpoint taken before a table-shape prop change', () => {
		const pageId = createPage(owner, '{}')
		// A table saved at props version 2, before rowIds/colIds existed
		const old = JSON.parse(snapshotWith(owner))
		const table = tableShape('shape:table') as any
		delete table.props.rowIds
		delete table.props.colIds
		old.documents.push({ state: table, lastChangedClock: 0 })
		old.schema.sequences['com.tldraw.shape.table'] = 2
		const target = dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: JSON.stringify(old) })

		// Inactive room: the stored row gets the migrated record
		assert.equal(cp.restoreCheckpoint(pageId, target.id, owner).ok, true)
		const stored = JSON.parse(getStoredSnapshot(pageId)!)
		const restored = stored.documents.find((d: any) => d.state.id === 'shape:table').state
		assert.deepEqual(restored.props.rowIds, ['r0', 'r1'])
		assert.deepEqual(restored.props.colIds, ['c0', 'c1'])
		assert.equal(stored.schema.sequences['com.tldraw.shape.table'], 3)

		// Live room: same, through the room
		const room = rm.getOrCreateRoom(pageId)!
		putShape(room, 'shape:extra')
		assert.equal(cp.restoreCheckpoint(pageId, target.id, owner).ok, true)
		const live = room.getRecord('shape:table' as any) as any
		assert.deepEqual(live.props.rowIds, ['r0', 'r1'])
		assert.equal(room.getRecord('shape:extra' as any), undefined)
		rm.evictRoom(pageId)
	})

	it('cascades with the page', () => {
		const pageId = createPage(owner, '{}')
		dbcp.insertCheckpoint({ pageId, kind: 'manual', snapshot: '{}' })
		db.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
		assert.equal(listCheckpointRows(pageId).length, 0)
	})
})
