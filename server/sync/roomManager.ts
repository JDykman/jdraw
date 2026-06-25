import { TLSocketRoom } from '@tldraw/sync-core'
import { TLRecord } from '@tldraw/tlschema'
import { createTLSchema } from '@tldraw/tlschema'
import { db } from '../db/db.js'

interface ActiveRoom {
	room: TLSocketRoom<TLRecord>
	connections: number
	persistTimer: ReturnType<typeof setTimeout> | null
	changePersistTimer: ReturnType<typeof setTimeout> | null
}

const rooms = new Map<string, ActiveRoom>()
const schema = createTLSchema()

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

function createRoom(pageId: string, initialSnapshot: ReturnType<typeof loadSnapshot>): TLSocketRoom<TLRecord> {
	return new TLSocketRoom<TLRecord>({
		schema,
		initialSnapshot,
		onDataChange: () => scheduleChangePersist(pageId),
	})
}

export function getOrCreateRoom(pageId: string): TLSocketRoom<TLRecord> {
	let entry = rooms.get(pageId)
	if (!entry) {
		const initialSnapshot = loadSnapshot(pageId)
		let room: TLSocketRoom<TLRecord>
		try {
			room = createRoom(pageId, initialSnapshot)
		} catch (e: any) {
			console.error(`Failed to load snapshot for room ${pageId}, starting fresh:`, e.message)
			room = createRoom(pageId, undefined)
		}
		entry = { room, connections: 0, persistTimer: null, changePersistTimer: null }
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
