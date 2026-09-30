import { RoomSnapshot, TLSocketRoom } from '@tldraw/sync-core'
import { TLRecord } from '@tldraw/tlschema'
import { createTLSchema, defaultShapeSchemas } from '@tldraw/tlschema'
import { tableShapeSchema } from '../../shared/table/tableShapeProps.js'
import { quarantineSnapshot } from '../db/checkpoints.js'
import { db } from '../db/db.js'

export interface SessionMeta {
	userId: string
	canEdit: boolean
}

interface ActiveRoom {
	room: TLSocketRoom<TLRecord, SessionMeta>
	// Only rooms built from a successful (or empty) load may ever be persisted
	loadedOk: boolean
	// User whose document push arrived since the last persist, for pages.last_edited_by
	lastEditorId: string | null
	connections: number
	persistTimer: ReturnType<typeof setTimeout> | null
	changePersistTimer: ReturnType<typeof setTimeout> | null
}

export type SnapshotLoadResult =
	| { outcome: 'empty' }
	| { outcome: 'loaded'; snapshot: RoomSnapshot; raw: string }
	| { outcome: 'failed'; error: Error; raw: string }

const rooms = new Map<string, ActiveRoom>()
// Pages whose stored snapshot couldn't be loaded. No room exists for them and nothing is
// written to page_snapshots until a restore clears the entry.
const failedLoads = new Map<string, { error: string; at: number }>()

// Must include every custom shape the client registers, or sync rejects those records.
export const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas, table: tableShapeSchema },
})

const ROOM_EVICTION_DELAY_MS = 30_000
const CHANGE_PERSIST_DELAY_MS = 1_000

/** Read and parse a page's stored snapshot without building a room. */
export function readStoredSnapshot(pageId: string): SnapshotLoadResult {
	const row = db
		.prepare('SELECT snapshot FROM page_snapshots WHERE page_id = ?')
		.get(pageId) as { snapshot: string } | undefined
	if (!row || row.snapshot === '{}') return { outcome: 'empty' }
	try {
		const snapshot = JSON.parse(row.snapshot)
		if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot is not an object')
		return { outcome: 'loaded', snapshot, raw: row.snapshot }
	} catch (e) {
		return { outcome: 'failed', error: e instanceof Error ? e : new Error(String(e)), raw: row.snapshot }
	}
}

/**
 * The room constructor migrates records but doesn't validate them, so a snapshot with an unknown
 * shape type would load "successfully" and be persisted back. Validate every record ourselves.
 */
function validateRoomRecords(room: TLSocketRoom<TLRecord, SessionMeta>) {
	for (const { state } of room.getCurrentSnapshot().documents) {
		const type = schema.types[state.typeName as keyof typeof schema.types]
		if (!type) throw new Error(`Unknown record type "${state.typeName}" (${state.id})`)
		type.validate(state)
	}
}

/**
 * Build a room from a snapshot, migrating and validating it. Throws if the snapshot can't be
 * loaded; the caller decides what that means (quarantine on boot, 422 on restore).
 */
export function buildRoom(
	pageId: string,
	initialSnapshot: RoomSnapshot | undefined
): TLSocketRoom<TLRecord, SessionMeta> {
	const room = new TLSocketRoom<TLRecord, SessionMeta>({
		schema,
		initialSnapshot,
		onDataChange: () => scheduleChangePersist(pageId),
		onAfterReceiveMessage: (args) => {
			// A push carrying a document diff (not just presence) from someone allowed to edit.
			// `message` is present at runtime but excluded from the public typings.
			const { meta } = args
			const msg = (args as unknown as { message: { type?: string; diff?: unknown } }).message
			if (msg.type !== 'push' || !msg.diff || !meta.canEdit) return
			const entry = rooms.get(pageId)
			if (entry) entry.lastEditorId = meta.userId
		},
	})
	try {
		validateRoomRecords(room)
	} catch (e) {
		room.close()
		throw e
	}
	return room
}

/** Validate a snapshot by building a throwaway room from it. Returns the migrated snapshot. */
export function migrateSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
	const room = buildRoom('validation', snapshot)
	try {
		return room.getCurrentSnapshot()
	} finally {
		room.close()
	}
}

function writeRoomSnapshot(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry) return
	if (!entry.loadedOk || failedLoads.has(pageId)) {
		console.error(`Refusing to persist room ${pageId}: it was not created from a successful load`)
		return
	}
	try {
		// The page may have been deleted while the room was open; nothing to persist then
		if (!db.prepare('SELECT 1 FROM pages WHERE id = ?').get(pageId)) return
		const snapshot = entry.room.getCurrentSnapshot()
		const now = Date.now()
		db.prepare(
			`INSERT INTO page_snapshots (page_id, snapshot, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(page_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`
		).run(pageId, JSON.stringify(snapshot), now)
		if (entry.lastEditorId) {
			db.prepare('UPDATE pages SET last_edited_by = ?, last_edited_at = ? WHERE id = ?').run(
				entry.lastEditorId,
				now,
				pageId
			)
			entry.lastEditorId = null
		}
	} catch (e) {
		console.error(`Failed to persist room ${pageId}:`, e)
	}
}

export function persistRoomNow(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry) return
	if (entry.changePersistTimer) {
		clearTimeout(entry.changePersistTimer)
		entry.changePersistTimer = null
	}
	writeRoomSnapshot(pageId)
}

function scheduleChangePersist(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry || entry.changePersistTimer) return
	entry.changePersistTimer = setTimeout(() => {
		const latestEntry = rooms.get(pageId)
		if (!latestEntry) return
		latestEntry.changePersistTimer = null
		writeRoomSnapshot(pageId)
	}, CHANGE_PERSIST_DELAY_MS)
}

/**
 * The live room for a page, created from the stored snapshot on first use. Returns null when
 * the stored snapshot can't be loaded: the raw text is quarantined and no room is created, so
 * nothing can overwrite the stored row.
 */
export function getOrCreateRoom(pageId: string): TLSocketRoom<TLRecord, SessionMeta> | null {
	const existing = rooms.get(pageId)
	if (existing) return existing.room
	if (failedLoads.has(pageId)) return null

	const load = readStoredSnapshot(pageId)
	let room: TLSocketRoom<TLRecord, SessionMeta>
	try {
		if (load.outcome === 'failed') throw load.error
		room = buildRoom(pageId, load.outcome === 'loaded' ? load.snapshot : undefined)
	} catch (e) {
		const error = e instanceof Error ? e : new Error(String(e))
		const raw = load.outcome === 'empty' ? '' : load.raw
		console.error(`Failed to load snapshot for page ${pageId}; quarantining it:`, error.message)
		if (raw) quarantineSnapshot(pageId, raw)
		failedLoads.set(pageId, { error: error.message, at: Date.now() })
		return null
	}
	rooms.set(pageId, {
		room,
		loadedOk: true,
		lastEditorId: null,
		connections: 0,
		persistTimer: null,
		changePersistTimer: null,
	})
	return room
}

export function getActiveRoom(pageId: string): TLSocketRoom<TLRecord, SessionMeta> | null {
	return rooms.get(pageId)?.room ?? null
}

export function isPageLoadFailed(pageId: string): boolean {
	return failedLoads.has(pageId)
}

export function getPageLoadFailure(pageId: string): { error: string; at: number } | null {
	return failedLoads.get(pageId) ?? null
}

/** Forget a failed load (after a restore replaced the stored row) so the next connection reloads. */
export function clearFailedLoad(pageId: string) {
	failedLoads.delete(pageId)
}

export function recordConnection(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry) return
	entry.connections++
	if (entry.persistTimer) {
		clearTimeout(entry.persistTimer)
		entry.persistTimer = null
	}
}

export function recordDisconnection(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry) return
	entry.connections = Math.max(0, entry.connections - 1)
	if (entry.connections === 0 && !entry.persistTimer) {
		persistRoomNow(pageId)
		entry.persistTimer = setTimeout(() => evictRoom(pageId), ROOM_EVICTION_DELAY_MS)
	}
}

/** Persist and drop a room. Sessions still attached are closed and will reconnect. */
export function evictRoom(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry) return
	if (entry.persistTimer) {
		clearTimeout(entry.persistTimer)
		entry.persistTimer = null
	}
	persistRoomNow(pageId)
	rooms.delete(pageId)
	entry.room.close()
}

export function persistAllRooms() {
	for (const [pageId, entry] of rooms) {
		if (entry.persistTimer) {
			clearTimeout(entry.persistTimer)
			entry.persistTimer = null
		}
		persistRoomNow(pageId)
	}
}

/** Flush every pending write and close every room. Used on shutdown, before db.close(). */
export function shutdownRooms() {
	for (const pageId of [...rooms.keys()]) evictRoom(pageId)
}

/** The page's latest document as JSON: the live room if it's open, otherwise the stored snapshot. */
export function getPageSnapshotJson(pageId: string): string | null {
	const entry = rooms.get(pageId)
	if (entry) return JSON.stringify(entry.room.getCurrentSnapshot())
	const row = db.prepare('SELECT snapshot FROM page_snapshots WHERE page_id = ?').get(pageId) as
		| { snapshot: string }
		| undefined
	return row?.snapshot ?? null
}
