import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeLayout, GROUP_PADDING } from '../layout'

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('computeLayout', () => {
	it('normalises to the origin and keeps the old shape without groups', () => {
		const { positions, groups } = computeLayout(
			[
				{ id: 'a', w: 100, h: 50 },
				{ id: 'b', w: 100, h: 50 },
			],
			[{ from: 'a', to: 'b' }],
			{ direction: 'LR' }
		)
		assert.equal(groups.size, 0)
		assert.deepEqual(positions.get('a'), { x: 0, y: 0 })
		assert.ok(positions.get('b')!.x >= 100)
	})

	it('lays grouped nodes out as clusters with padded, non-overlapping frames', () => {
		const nodes = [
			{ id: 'u', w: 120, h: 60, group: 'id' },
			{ id: 'r', w: 120, h: 60, group: 'id' },
			{ id: 'i', w: 120, h: 60, group: 'bill' },
			{ id: 'p', w: 120, h: 60, group: 'bill' },
			{ id: 'loose', w: 120, h: 60 },
		]
		const edges = [
			{ from: 'u', to: 'r' },
			{ from: 'i', to: 'u' },
			{ from: 'i', to: 'p' },
			{ from: 'loose', to: 'u' },
		]
		const { positions, groups } = computeLayout(nodes, edges, { direction: 'TB' })
		assert.deepEqual([...groups.keys()].sort(), ['bill', 'id'])
		for (const n of nodes) {
			const p = positions.get(n.id)!
			assert.ok(p.x >= 0 && p.y >= 0)
			if (!n.group) continue
			const b = groups.get(n.group)!
			// Member sits inside its frame with the padding to spare
			assert.ok(p.x >= b.x + GROUP_PADDING - 1e-6 && p.y >= b.y + GROUP_PADDING - 1e-6, `${n.id} inside ${n.group}`)
			assert.ok(p.x + n.w <= b.x + b.w - GROUP_PADDING + 1e-6 && p.y + n.h <= b.y + b.h - GROUP_PADDING + 1e-6)
		}
		assert.ok(!overlaps(groups.get('id')!, groups.get('bill')!), 'frames do not overlap')
		const loose = positions.get('loose')!
		for (const b of groups.values()) {
			assert.ok(!overlaps({ ...loose, w: 120, h: 60 }, b), 'ungrouped node stays outside frames')
		}
	})
})
