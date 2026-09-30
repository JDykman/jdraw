import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TLPageId, TLRecord, TLShape, TLShapeId } from 'tldraw'
import { countDiff, deepEqual, diffShapes, formatCounts, roomSnapshotToStoreSnapshot, shapesOnPage } from '../snapshotDiff'

function shape(id: string, parentId = 'page:page', extra: Record<string, unknown> = {}): TLShape {
	return {
		id: id as TLShapeId,
		typeName: 'shape',
		type: 'geo',
		x: 0,
		y: 0,
		rotation: 0,
		index: 'a1',
		parentId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: 10, h: 10 },
		...extra,
	} as unknown as TLShape
}

const PAGE = 'page:page' as TLPageId
const MOVED = 'shape:moved' as TLShapeId
const xOf = (r: TLRecord) => (r as TLShape).x

describe('deepEqual', () => {
	it('ignores key order and compares nested values', () => {
		assert.equal(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true)
		assert.equal(deepEqual({ a: 1 }, { a: 2 }), false)
		assert.equal(deepEqual([1, 2], [2, 1]), false)
		assert.equal(deepEqual({ a: undefined }, {}), false)
		assert.equal(deepEqual(null, {}), false)
	})
})

describe('shapesOnPage', () => {
	it('keeps shapes on the page, including nested ones, and drops everything else', () => {
		const records = [
			shape('shape:a'),
			shape('shape:frame'),
			shape('shape:inFrame', 'shape:frame'),
			shape('shape:deep', 'shape:inFrame'),
			shape('shape:other', 'page:other'),
			shape('shape:orphan', 'shape:missing'),
			{ id: 'binding:1', typeName: 'binding' } as unknown as TLRecord,
			{ id: 'asset:1', typeName: 'asset' } as unknown as TLRecord,
			{ id: 'page:page', typeName: 'page' } as unknown as TLRecord,
		]
		const result = shapesOnPage(records, PAGE)
		assert.deepEqual([...result.keys()].sort(), ['shape:a', 'shape:deep', 'shape:frame', 'shape:inFrame'])
	})

	it('survives a parent cycle', () => {
		const result = shapesOnPage([shape('shape:x', 'shape:y'), shape('shape:y', 'shape:x')], PAGE)
		assert.equal(result.size, 0)
	})
})

describe('diffShapes', () => {
	it('classifies added, removed and updated shapes', () => {
		const before = new Map<TLShapeId, TLShape>([
			['shape:same' as TLShapeId, shape('shape:same')],
			['shape:moved' as TLShapeId, shape('shape:moved', 'page:page', { x: 0 })],
			['shape:gone' as TLShapeId, shape('shape:gone')],
		])
		const after = new Map<TLShapeId, TLShape>([
			['shape:same' as TLShapeId, shape('shape:same')],
			['shape:moved' as TLShapeId, shape('shape:moved', 'page:page', { x: 50 })],
			['shape:new' as TLShapeId, shape('shape:new')],
		])
		const diff = diffShapes(before, after)
		assert.deepEqual(Object.keys(diff.added), ['shape:new'])
		assert.deepEqual(Object.keys(diff.removed), ['shape:gone'])
		assert.deepEqual(Object.keys(diff.updated), ['shape:moved'])
		assert.equal(xOf(diff.updated[MOVED][0]), 0)
		assert.equal(xOf(diff.updated[MOVED][1]), 50)
		assert.deepEqual(countDiff(diff), { added: 1, updated: 1, removed: 1 })
		assert.equal(formatCounts(countDiff(diff)), '+1 added, 1 changed, 1 removed')

		// The other direction is the inverse
		const reverse = diffShapes(after, before)
		assert.deepEqual(Object.keys(reverse.added), ['shape:gone'])
		assert.deepEqual(Object.keys(reverse.removed), ['shape:new'])
		assert.equal(xOf(reverse.updated[MOVED][0]), 50)
	})

	it('reports no differences for identical maps', () => {
		const m = new Map<TLShapeId, TLShape>([['shape:a' as TLShapeId, shape('shape:a')]])
		assert.equal(formatCounts(countDiff(diffShapes(m, new Map(m)))), 'No differences')
	})
})

describe('roomSnapshotToStoreSnapshot', () => {
	it('keys records by id and keeps the schema', () => {
		const schema = { schemaVersion: 2, sequences: {} } as const
		const out = roomSnapshotToStoreSnapshot({ documents: [{ state: shape('shape:a') }], schema })
		assert.deepEqual(Object.keys(out.store), ['shape:a'])
		assert.equal(out.schema, schema)
		assert.throws(() => roomSnapshotToStoreSnapshot({ documents: [] }))
	})
})
