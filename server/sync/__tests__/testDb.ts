import { randomUUID } from 'crypto'

// db.ts opens the database at import time, so the path must be set before it is imported
process.env.DB_PATH = ':memory:'
process.env.BACKUP_DISABLED = '1'

const { db } = await import('../../db/db.js')

export { db }

export function createUser(username = `user-${randomUUID().slice(0, 8)}`): string {
	const id = randomUUID()
	db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)').run(
		id,
		username,
		'x',
		Date.now()
	)
	return id
}

export function createPage(ownerId: string, snapshot: string | null = '{}'): string {
	const id = randomUUID()
	const now = Date.now()
	db.prepare('INSERT INTO pages (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
		id,
		ownerId,
		'Test page',
		now,
		now
	)
	if (snapshot !== null) {
		db.prepare('INSERT INTO page_snapshots (page_id, snapshot, updated_at) VALUES (?, ?, ?)').run(id, snapshot, now)
	}
	return id
}

export function getStoredSnapshot(pageId: string): string | undefined {
	const row = db.prepare('SELECT snapshot FROM page_snapshots WHERE page_id = ?').get(pageId) as
		| { snapshot: string }
		| undefined
	return row?.snapshot
}

export function listCheckpointRows(pageId: string) {
	return db
		.prepare('SELECT id, kind, label, snapshot, doc_clock, created_by, created_at FROM page_checkpoints WHERE page_id = ? ORDER BY created_at, rowid')
		.all(pageId) as { id: string; kind: string; label: string | null; snapshot: string; doc_clock: number | null; created_by: string | null; created_at: number }[]
}

export function geoShape(id: string, text = '', x = 0) {
	return {
		id,
		typeName: 'shape',
		type: 'geo',
		x,
		y: 0,
		rotation: 0,
		index: 'a1',
		parentId: 'page:page',
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			w: 100,
			h: 100,
			geo: 'rectangle',
			color: 'black',
			labelColor: 'black',
			fill: 'none',
			dash: 'draw',
			size: 'm',
			font: 'draw',
			align: 'middle',
			verticalAlign: 'middle',
			growY: 0,
			url: '',
			scale: 1,
			richText: { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] },
		},
	}
}

/** A current-version table shape (2 rows x 2 columns). */
export function tableShape(id: string) {
	return {
		id,
		typeName: 'shape',
		type: 'table',
		x: 0,
		y: 0,
		rotation: 0,
		index: 'a2',
		parentId: 'page:page',
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			w: 200,
			h: 80,
			rowIds: ['r0', 'r1'],
			colIds: ['c0', 'c1'],
			colWidths: [100, 100],
			rowHeights: [40, 40],
			cells: [
				['a', 'b'],
				['c', 'd'],
			],
			headerRow: true,
			title: '',
			showTitle: false,
			colAlign: [null, null],
			colMono: [false, false],
			color: 'black',
			fill: 'none',
			size: 'm',
			font: 'draw',
			textAlign: 'start',
		},
	}
}
