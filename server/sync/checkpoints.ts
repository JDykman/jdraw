import { RoomSnapshot } from '@tldraw/sync-core'
import {
	CheckpointMeta,
	getCheckpoint,
	insertCheckpoint,
	sweepExpiredCheckpoints,
} from '../db/checkpoints.js'
import { db } from '../db/db.js'
import {
	clearFailedLoad,
	getActiveRoom,
	isPageLoadFailed,
	loadSnapshotIntoRoom,
	markRoomCheckpointed,
	migrateSnapshot,
	persistRoomNow,
	readStoredSnapshot,
} from './roomManager.js'

const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Checkpoint the page's current document: the live room if one is open, otherwise the stored
 * snapshot. Returns null for a page in the failed-load state (its data is already quarantined).
 */
export function captureCheckpoint(
	pageId: string,
	kind: 'manual' | 'pre-restore',
	opts: { label?: string | null; createdBy?: string | null } = {}
): CheckpointMeta | null {
	if (isPageLoadFailed(pageId)) return null
	const room = getActiveRoom(pageId)
	let snapshot: string
	let docClock: number | null
	if (room) {
		snapshot = JSON.stringify(room.getCurrentSnapshot())
		docClock = room.getCurrentDocumentClock()
	} else {
		const stored = readStoredSnapshot(pageId)
		if (stored.outcome === 'failed') return null
		if (stored.outcome === 'empty') {
			snapshot = JSON.stringify(migrateSnapshot(undefined))
			docClock = 0
		} else {
			snapshot = stored.raw
			docClock = typeof stored.snapshot.documentClock === 'number' ? stored.snapshot.documentClock : null
		}
	}
	const meta = insertCheckpoint({ pageId, kind, snapshot, docClock, label: opts.label, createdBy: opts.createdBy })
	if (room) markRoomCheckpointed(pageId)
	return meta
}

export type RestoreResult =
	| { ok: true; preRestore: CheckpointMeta | null }
	| { ok: false; status: 400 | 404 | 422; error: string }

/**
 * Replace the page's document with a checkpoint. Always takes a 'pre-restore' checkpoint first
 * (unless the page is in the failed-load state, which is already quarantined), validates and
 * migrates the checkpoint before touching anything, and returns 422 without changes if that
 * fails. A live room gets the document through a storage transaction, which the sync room
 * broadcasts to every connected client as a normal patch; otherwise the stored row is replaced.
 */
export function restoreCheckpoint(pageId: string, checkpointId: string, userId: string): RestoreResult {
	const checkpoint = getCheckpoint(pageId, checkpointId)
	if (!checkpoint) return { ok: false, status: 404, error: 'Checkpoint not found' }
	if (checkpoint.kind === 'quarantine') {
		return { ok: false, status: 400, error: 'Quarantined snapshots cannot be restored directly' }
	}

	let migrated: RoomSnapshot
	try {
		const parsed = JSON.parse(checkpoint.snapshot)
		migrated = migrateSnapshot(parsed)
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return { ok: false, status: 422, error: `Checkpoint can't be loaded: ${message}` }
	}

	const room = getActiveRoom(pageId)
	if (room) {
		const preRestore = captureCheckpoint(pageId, 'pre-restore', { createdBy: userId })
		try {
			loadSnapshotIntoRoom(room, migrated)
		} catch (e) {
			// The storage transaction rolls back on throw, so the live document is unchanged
			const message = e instanceof Error ? e.message : String(e)
			return { ok: false, status: 422, error: `Checkpoint can't be loaded: ${message}` }
		}
		persistRoomNow(pageId)
		markRoomCheckpointed(pageId)
		return { ok: true, preRestore }
	}

	let preRestore: CheckpointMeta | null = null
	db.transaction(() => {
		preRestore = captureCheckpoint(pageId, 'pre-restore', { createdBy: userId })
		db.prepare(
			`INSERT INTO page_snapshots (page_id, snapshot, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(page_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`
		).run(pageId, JSON.stringify(migrated), Date.now())
	})()
	// The next connection loads the restored row normally
	clearFailedLoad(pageId)
	return { ok: true, preRestore }
}

/** Delete expired auto / pre-restore checkpoints now and once a day. */
export function startCheckpointRetention() {
	const run = () => {
		try {
			const removed = sweepExpiredCheckpoints()
			if (removed > 0) console.log(`Removed ${removed} expired checkpoint(s)`)
		} catch (e) {
			console.error('Checkpoint retention sweep failed:', e)
		}
	}
	run()
	setInterval(run, RETENTION_SWEEP_INTERVAL_MS).unref()
}
