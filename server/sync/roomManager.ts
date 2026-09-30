import { TLSocketRoom } from '@tldraw/sync-core'
import { TLRecord } from '@tldraw/tlschema'
import { createTLSchema, defaultShapeSchemas } from '@tldraw/tlschema'
import { tableShapeSchema } from '../../shared/table/tableShapeProps.js'
import { db } from '../db/db.js'

export interface SessionMeta {
	userId: string
	canEdit: boolean
}

interface ActiveRoom {
	room: TLSocketRoom<TLRecord, SessionMeta>
	// User whose document push arrived since the last persist, for pages.last_edited_by
	lastEditorId: string | null
	connections: number
	persistTimer: ReturnType<typeof setTimeout> | null
	changePersistTimer: ReturnType<typeof setTimeout> | null
}

const rooms = new Map<string, ActiveRoom>()
// Must include every custom shape the client registers, or sync rejects those records.
const schema = createTLSchema({
	shapes: { ...defaultShapeSchemas, table: tableShapeSchema },
})

const ROOM_EVICTION_DELAY_MS = 30_000
const CHANGE_PERSIST_DELAY_MS = 1_000

function loadSnapshot(pageId: string) {
	const row = db
		.prepare('SELECT snapshot FROM page_snapshots WHERE page_id = ?')
		.get(pageId) as { snapshot: string } | undefined
	if (!row || row.snapshot === '{}') return undefined
	try {
		return JSON.parse(row.snapshot)
	} catch {
		return undefined
	}
}

function writeRoomSnapshot(pageId: string) {
	const entry = rooms.get(pageId)
	if (!entry) return
	try {
		const snapshot = entry.room.getCurrentSnapshot()
		const now = Date.now()
		db.prepare(
			'UPDATE page_snapshots SET snapshot = ?, updated_at = ? WHERE page_id = ?'
		).run(JSON.stringify(snapshot), now, pageId)
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

function persistRoomNow(pageId: string) {
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

function createRoom(
	pageId: string,
	initialSnapshot: ReturnType<typeof loadSnapshot>
): TLSocketRoom<TLRecord, SessionMeta> {
	return new TLSocketRoom<TLRecord, SessionMeta>({
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
}

export function getOrCreateRoom(pageId: string): TLSocketRoom<TLRecord, SessionMeta> {
	let entry = rooms.get(pageId)
	if (!entry) {
		const initialSnapshot = loadSnapshot(pageId)
		let room: TLSocketRoom<TLRecord, SessionMeta>
		try {
			room = createRoom(pageId, initialSnapshot)
		} catch (e: any) {
			console.error(`Failed to load snapshot for room ${pageId}, starting fresh:`, e.message)
			room = createRoom(pageId, undefined)
		}
		entry = { room, lastEditorId: null, connections: 0, persistTimer: null, changePersistTimer: null }
		rooms.set(pageId, entry)
	}
	return entry.room
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
		entry.persistTimer = setTimeout(() => {
			persistRoomNow(pageId)
			rooms.delete(pageId)
		}, ROOM_EVICTION_DELAY_MS)
	}
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

/** The page's latest document as JSON: the live room if it's open, otherwise the stored snapshot. */
export function getPageSnapshotJson(pageId: string): string | null {
	const entry = rooms.get(pageId)
	if (entry) return JSON.stringify(entry.room.getCurrentSnapshot())
	const row = db.prepare('SELECT snapshot FROM page_snapshots WHERE page_id = ?').get(pageId) as
		| { snapshot: string }
		| undefined
	return row?.snapshot ?? null
}
