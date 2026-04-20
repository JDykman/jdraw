import { TLSocketRoom } from '@tldraw/sync-core'
import { TLRecord } from '@tldraw/tlschema'
import { createTLSchema } from '@tldraw/tlschema'
import { db } from '../db/db.js'

interface ActiveRoom {
	room: TLSocketRoom<TLRecord>
	connections: number
	persistTimer: ReturnType<typeof setTimeout> | null
}

const rooms = new Map<string, ActiveRoom>()
const schema = createTLSchema()

const PERSIST_DELAY_MS = 30_000

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

function persistRoom(pageId: string) {
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

export function getOrCreateRoom(pageId: string): TLSocketRoom<TLRecord> {
	let entry = rooms.get(pageId)
	if (!entry) {
		const initialSnapshot = loadSnapshot(pageId)
		const room = new TLSocketRoom({ schema, initialSnapshot })
		entry = { room, connections: 0, persistTimer: null }
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
	if (entry.connections === 0) {
		entry.persistTimer = setTimeout(() => {
			persistRoom(pageId)
			rooms.delete(pageId)
		}, PERSIST_DELAY_MS)
	}
}

export function persistAllRooms() {
	for (const [pageId, entry] of rooms) {
		if (entry.persistTimer) {
			clearTimeout(entry.persistTimer)
			entry.persistTimer = null
		}
		persistRoom(pageId)
	}
}
