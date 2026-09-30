import type { RecordsDiff, TLPageId, TLRecord, TLShape, TLShapeId, TLStoreSnapshot } from 'tldraw'

/** The server's stored form: records wrapped with their clocks, plus the schema they were saved under. */
export interface RoomSnapshotLike {
	documents: { state: TLRecord }[]
	schema?: TLStoreSnapshot['schema']
}

/** Unwrap a RoomSnapshot into the store snapshot shape that schema.migrateStoreSnapshot() accepts. */
export function roomSnapshotToStoreSnapshot(snapshot: RoomSnapshotLike): TLStoreSnapshot {
	if (!snapshot.schema) throw new Error('Snapshot has no schema')
	const store: Record<string, TLRecord> = {}
	for (const doc of snapshot.documents) store[doc.state.id] = doc.state
	return { store: store as TLStoreSnapshot['store'], schema: snapshot.schema }
}

export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
	if (Array.isArray(a) !== Array.isArray(b)) return false
	if (Array.isArray(a)) {
		const bArr = b as unknown[]
		if (a.length !== bArr.length) return false
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bArr[i])) return false
		return true
	}
	const aObj = a as Record<string, unknown>
	const bObj = b as Record<string, unknown>
	const aKeys = Object.keys(aObj)
	if (aKeys.length !== Object.keys(bObj).length) return false
	for (const key of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(bObj, key) || !deepEqual(aObj[key], bObj[key])) return false
	}
	return true
}

/**
 * The shapes of one store that live on the given tldraw page, including shapes nested in frames
 * or groups. Parent chains are resolved once per shape (memoised), so this is O(n).
 */
export function shapesOnPage(records: Iterable<TLRecord>, pageId: TLPageId): Map<TLShapeId, TLShape> {
	const shapes = new Map<TLShapeId, TLShape>()
	for (const record of records) {
		if (record.typeName === 'shape') shapes.set(record.id, record)
	}
	const pageOf = new Map<TLShapeId, string | null>()
	const resolve = (shape: TLShape): string | null => {
		const cached = pageOf.get(shape.id)
		if (cached !== undefined) return cached
		// Guard against parent cycles in damaged data
		pageOf.set(shape.id, null)
		let page: string | null
		if (shape.parentId.startsWith('page:')) page = shape.parentId
		else {
			const parent = shapes.get(shape.parentId as TLShapeId)
			page = parent ? resolve(parent) : null
		}
		pageOf.set(shape.id, page)
		return page
	}
	const result = new Map<TLShapeId, TLShape>()
	for (const shape of shapes.values()) {
		if (resolve(shape) === pageId) result.set(shape.id, shape)
	}
	return result
}

export interface ShapeDiffCounts {
	added: number
	updated: number
	removed: number
}

/**
 * Diff of shape records from `before` to `after`: added = only in after, removed = only in
 * before, updated = in both but not deep-equal. Bindings, assets and other record types are
 * ignored. O(n) in the number of shapes.
 */
export function diffShapes(
	before: Map<TLShapeId, TLShape>,
	after: Map<TLShapeId, TLShape>
): RecordsDiff<TLRecord> {
	const diff: RecordsDiff<TLRecord> = { added: {}, updated: {}, removed: {} }
	for (const [id, shape] of after) {
		const prev = before.get(id)
		if (!prev) diff.added[id] = shape
		else if (!deepEqual(prev, shape)) diff.updated[id] = [prev, shape]
	}
	for (const [id, shape] of before) {
		if (!after.has(id)) diff.removed[id] = shape
	}
	return diff
}

export function countDiff(diff: RecordsDiff<TLRecord>): ShapeDiffCounts {
	return {
		added: Object.keys(diff.added).length,
		updated: Object.keys(diff.updated).length,
		removed: Object.keys(diff.removed).length,
	}
}

export function formatCounts({ added, updated, removed }: ShapeDiffCounts): string {
	if (added + updated + removed === 0) return 'No differences'
	return [`+${added} added`, `${updated} changed`, `${removed} removed`].join(', ')
}
