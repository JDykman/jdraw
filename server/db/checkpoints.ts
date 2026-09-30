import { randomUUID } from 'crypto'
import { db } from './db.js'

export type CheckpointKind = 'auto' | 'manual' | 'pre-restore' | 'quarantine'

export interface CheckpointMeta {
	id: string
	pageId: string
	kind: CheckpointKind
	label: string | null
	docClock: number | null
	createdBy: string | null
	createdByName: string | null
	createdAt: number
}

export interface CheckpointRow extends CheckpointMeta {
	snapshot: string
}

/** Auto and pre-restore checkpoints are swept after this long; manual and quarantine are kept. */
export const CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface DbRow {
	id: string
	page_id: string
	kind: CheckpointKind
	label: string | null
	doc_clock: number | null
	created_by: string | null
	created_by_name: string | null
	created_at: number
	snapshot?: string
}

const META_COLUMNS = `c.id, c.page_id, c.kind, c.label, c.doc_clock, c.created_by, u.username AS created_by_name, c.created_at`

function toMeta(row: DbRow): CheckpointMeta {
	return {
		id: row.id,
		pageId: row.page_id,
		kind: row.kind,
		label: row.label,
		docClock: row.doc_clock,
		createdBy: row.created_by,
		createdByName: row.created_by_name,
		createdAt: row.created_at,
	}
}

export function insertCheckpoint(input: {
	pageId: string
	kind: CheckpointKind
	snapshot: string
	label?: string | null
	docClock?: number | null
	createdBy?: string | null
	now?: number
}): CheckpointMeta {
	const id = randomUUID()
	const createdAt = input.now ?? Date.now()
	db.prepare(
		`INSERT INTO page_checkpoints (id, page_id, kind, label, snapshot, doc_clock, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	).run(id, input.pageId, input.kind, input.label ?? null, input.snapshot, input.docClock ?? null, input.createdBy ?? null, createdAt)
	return {
		id,
		pageId: input.pageId,
		kind: input.kind,
		label: input.label ?? null,
		docClock: input.docClock ?? null,
		createdBy: input.createdBy ?? null,
		createdByName: null,
		createdAt,
	}
}

/**
 * Preserve a stored snapshot that failed to load. Reconnect attempts hit this repeatedly, so an
 * identical quarantine row for the page is not duplicated.
 */
export function quarantineSnapshot(pageId: string, raw: string): CheckpointMeta | null {
	const existing = db
		.prepare(`SELECT 1 FROM page_checkpoints WHERE page_id = ? AND kind = 'quarantine' AND snapshot = ?`)
		.get(pageId, raw)
	if (existing) return null
	return insertCheckpoint({ pageId, kind: 'quarantine', snapshot: raw })
}

export function listCheckpoints(pageId: string): CheckpointMeta[] {
	const rows = db
		.prepare(
			`SELECT ${META_COLUMNS} FROM page_checkpoints c LEFT JOIN users u ON u.id = c.created_by
			 WHERE c.page_id = ? ORDER BY c.created_at DESC, c.id DESC`
		)
		.all(pageId) as DbRow[]
	return rows.map(toMeta)
}

export function getCheckpoint(pageId: string, checkpointId: string): CheckpointRow | null {
	const row = db
		.prepare(
			`SELECT ${META_COLUMNS}, c.snapshot FROM page_checkpoints c LEFT JOIN users u ON u.id = c.created_by
			 WHERE c.page_id = ? AND c.id = ?`
		)
		.get(pageId, checkpointId) as DbRow | undefined
	if (!row) return null
	return { ...toMeta(row), snapshot: row.snapshot! }
}

/** The most recent checkpoint's doc clock, used to skip auto checkpoints when nothing changed. */
export function getLatestCheckpointClock(pageId: string): number | null {
	const row = db
		.prepare(
			`SELECT doc_clock FROM page_checkpoints WHERE page_id = ? AND kind != 'quarantine'
			 ORDER BY created_at DESC, id DESC LIMIT 1`
		)
		.get(pageId) as { doc_clock: number | null } | undefined
	return row?.doc_clock ?? null
}

export function deleteCheckpoint(pageId: string, checkpointId: string): boolean {
	const info = db.prepare('DELETE FROM page_checkpoints WHERE page_id = ? AND id = ?').run(pageId, checkpointId)
	return info.changes > 0
}

/** Delete expired auto / pre-restore checkpoints. Returns the number removed. */
export function sweepExpiredCheckpoints(now = Date.now()): number {
	const info = db
		.prepare(`DELETE FROM page_checkpoints WHERE kind IN ('auto', 'pre-restore') AND created_at < ?`)
		.run(now - CHECKPOINT_RETENTION_MS)
	return info.changes
}
