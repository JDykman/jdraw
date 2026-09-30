import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createPage, createUser, db, geoShape, getStoredSnapshot, listCheckpointRows } from './testDb.js'

const rm = await import('../roomManager.js')

after(() => rm.shutdownRooms())

function docIds(room: NonNullable<ReturnType<typeof rm.getOrCreateRoom>>): string[] {
	return room.getCurrentSnapshot().documents.map((d) => d.state.id as string).sort()
}

describe('readStoredSnapshot', () => {
	const owner = createUser()

	it('is empty when there is no row or the placeholder', () => {
		assert.equal(rm.readStoredSnapshot(createPage(owner, null)).outcome, 'empty')
		assert.equal(rm.readStoredSnapshot(createPage(owner, '{}')).outcome, 'empty')
	})

	it('is loaded for valid JSON', () => {
		const result = rm.readStoredSnapshot(createPage(owner, '{"documents":[]}'))
		assert.equal(result.outcome, 'loaded')
	})

	it('is failed for invalid JSON and keeps the raw text', () => {
		const result = rm.readStoredSnapshot(createPage(owner, '{not json'))
		assert.equal(result.outcome, 'failed')
		if (result.outcome === 'failed') assert.equal(result.raw, '{not json')
	})
})

describe('getOrCreateRoom', () => {
	const owner = createUser()

	it('creates an empty room for an empty page and persists edits', () => {
		const pageId = createPage(owner, '{}')
		const room = rm.getOrCreateRoom(pageId)
		assert.ok(room)
		assert.deepEqual(docIds(room), ['document:document', 'page:page'])
		room.storage.transaction((txn) => txn.set('shape:a' as any, geoShape('shape:a') as any))
		rm.persistRoomNow(pageId)
		const stored = JSON.parse(getStoredSnapshot(pageId)!)
		assert.ok(stored.documents.some((d: any) => d.state.id === 'shape:a'))
		rm.evictRoom(pageId)
	})

	it('loads an existing snapshot', () => {
		const seedId = createPage(owner, '{}')
		const seed = rm.getOrCreateRoom(seedId)!
		seed.storage.transaction((txn) => txn.set('shape:b' as any, geoShape('shape:b', 'hello') as any))
		const json = JSON.stringify(seed.getCurrentSnapshot())
		rm.evictRoom(seedId)

		const pageId = createPage(owner, json)
		const room = rm.getOrCreateRoom(pageId)
		assert.ok(room)
		assert.ok(docIds(room).includes('shape:b'))
		rm.evictRoom(pageId)
	})

	it('upserts the snapshot row when it is missing', () => {
		const pageId = createPage(owner, null)
		assert.equal(getStoredSnapshot(pageId), undefined)
		const room = rm.getOrCreateRoom(pageId)!
		room.storage.transaction((txn) => txn.set('shape:c' as any, geoShape('shape:c') as any))
		rm.persistRoomNow(pageId)
		assert.ok(getStoredSnapshot(pageId)?.includes('shape:c'))
		rm.evictRoom(pageId)
	})

	it('quarantines invalid JSON, creates no room and never overwrites the row', () => {
		const raw = '{"documents": [oops'
		const pageId = createPage(owner, raw)
		assert.equal(rm.getOrCreateRoom(pageId), null)
		assert.equal(rm.isPageLoadFailed(pageId), true)
		assert.equal(rm.getActiveRoom(pageId), null)

		const rows = listCheckpointRows(pageId)
		assert.equal(rows.length, 1)
		assert.equal(rows[0].kind, 'quarantine')
		assert.equal(rows[0].snapshot, raw)
		assert.equal(getStoredSnapshot(pageId), raw)

		// Reconnect attempts: still rejected, no duplicate quarantine, row untouched
		assert.equal(rm.getOrCreateRoom(pageId), null)
		rm.persistAllRooms()
		assert.equal(listCheckpointRows(pageId).length, 1)
		assert.equal(getStoredSnapshot(pageId), raw)
	})

	it('quarantines valid JSON with an unknown shape type', () => {
		const seedId = createPage(owner, '{}')
		const snapshot = rm.getOrCreateRoom(seedId)!.getCurrentSnapshot()
		rm.evictRoom(seedId)
		snapshot.documents.push({ state: { ...geoShape('shape:bad'), type: 'bogus' } as any, lastChangedClock: 0 })
		const raw = JSON.stringify(snapshot)

		const pageId = createPage(owner, raw)
		assert.equal(rm.getOrCreateRoom(pageId), null)
		const rows = listCheckpointRows(pageId)
		assert.equal(rows.length, 1)
		assert.equal(rows[0].kind, 'quarantine')
		assert.equal(rows[0].snapshot, raw)
		assert.equal(getStoredSnapshot(pageId), raw)
		assert.match(rm.getPageLoadFailure(pageId)!.error, /bogus|shape\.type/)
	})

	it('loads again after the failure is cleared and the row replaced', () => {
		const pageId = createPage(owner, 'garbage')
		assert.equal(rm.getOrCreateRoom(pageId), null)
		db.prepare('UPDATE page_snapshots SET snapshot = ? WHERE page_id = ?').run('{}', pageId)
		assert.equal(rm.getOrCreateRoom(pageId), null, 'still failed until cleared')
		rm.clearFailedLoad(pageId)
		const room = rm.getOrCreateRoom(pageId)
		assert.ok(room)
		rm.evictRoom(pageId)
	})
})

describe('migrateSnapshot', () => {
	it('returns a migrated copy for an older schema and throws for an unknown one', () => {
		const owner = createUser()
		const pageId = createPage(owner, '{}')
		const snapshot = rm.getOrCreateRoom(pageId)!.getCurrentSnapshot()
		rm.evictRoom(pageId)

		const old = structuredClone(snapshot) as any
		old.schema = { schemaVersion: 2, sequences: { 'com.tldraw.store': 0 } }
		const migrated = rm.migrateSnapshot(old) as any
		assert.ok(migrated.schema.sequences['com.tldraw.store'] > 0)

		const future = structuredClone(snapshot) as any
		future.schema.sequences['com.tldraw.shape.table'] = 99
		assert.throws(() => rm.migrateSnapshot(future))
	})
})
