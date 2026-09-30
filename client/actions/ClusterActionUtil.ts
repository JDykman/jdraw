import { createShapeId, TLFrameShape, TLShape, TLShapeId } from 'tldraw'
import { ClusterAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const GAP = 16
const PADDING = 24
const GROUP_GAP = 64

export const ClusterActionUtil = registerActionUtil(
	class ClusterActionUtil extends AgentActionUtil<ClusterAction> {
		static override type = 'cluster' as const

		override getInfo(action: Streaming<ClusterAction>) {
			return {
				icon: 'cursor' as const,
				description: action.intent ?? '',
			}
		}

		override sanitizeAction(action: Streaming<ClusterAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			// A shape can only live in one group: first mention wins
			const seen = new Set<string>()
			action.groups = action.groups
				.map((g) => ({
					title: g.title,
					shapeIds: helpers.ensureShapeIdsExist(g.shapeIds).filter((id) => !seen.has(id) && seen.add(id)),
				}))
				.filter((g) => g.shapeIds.length > 0)
			return action
		}

		override applyAction(action: Streaming<ClusterAction>) {
			if (!action.complete || action.groups.length === 0) return
			const { editor } = this

			const groups = action.groups.map((g) => ({
				title: g.title,
				shapes: g.shapeIds
					.map((id) => editor.getShape(`shape:${id}` as TLShapeId))
					.filter((s): s is TLShape => !!s)
					// Keep the reading order people already had
					.sort((a, b) => {
						const pa = editor.getShapePageBounds(a)!
						const pb = editor.getShapePageBounds(b)!
						return pa.y - pb.y || pa.x - pb.x
					}),
			}))
			const all = groups.flatMap((g) => g.shapes)
			const bounds = editor.getShapesPageBounds(all.map((s) => s.id))
			if (!bounds) return

			// Frames from an earlier clustering that this one empties get removed afterwards
			const previousFrames = new Set(
				all
					.map((s) => editor.getShape(s.parentId as TLShapeId))
					.filter((p): p is TLShape => !!p && p.type === 'frame' && p.meta.cluster === true)
					.map((p) => p.id)
			)

			let x = bounds.x
			const y = bounds.y
			for (const group of groups) {
				const sizes = group.shapes.map((s) => editor.getShapePageBounds(s)!)
				const cellW = Math.max(...sizes.map((b) => b.w))
				const cellH = Math.max(...sizes.map((b) => b.h))
				const n = group.shapes.length
				const cols = n <= 4 ? 1 : n <= 12 ? 2 : 3
				const rows = Math.ceil(n / cols)
				const w = cols * cellW + (cols - 1) * GAP + PADDING * 2
				const h = rows * cellH + (rows - 1) * GAP + PADDING * 2

				const frameId = createShapeId()
				editor.createShape<TLFrameShape>({
					id: frameId,
					type: 'frame',
					x,
					y,
					props: { w, h, name: group.title },
					meta: { cluster: true },
				})
				editor.reparentShapes(
					group.shapes.map((s) => s.id),
					frameId
				)
				editor.updateShapes(
					group.shapes.map((s, i) => {
						const b = sizes[i]
						const col = i % cols
						const row = Math.floor(i / cols)
						// Centre each shape in its cell; x/y are frame-local after reparenting
						const current = editor.getShape(s.id)!
						const pageBounds = editor.getShapePageBounds(current)!
						const offsetX = current.x - (pageBounds.x - x)
						const offsetY = current.y - (pageBounds.y - y)
						return {
							id: s.id,
							type: s.type,
							x: PADDING + col * (cellW + GAP) + (cellW - b.w) / 2 + offsetX,
							y: PADDING + row * (cellH + GAP) + (cellH - b.h) / 2 + offsetY,
						}
					})
				)
				x += w + GROUP_GAP
			}

			const emptied = [...previousFrames].filter((id) => editor.getSortedChildIdsForParent(id).length === 0)
			if (emptied.length) editor.deleteShapes(emptied)
		}
	}
)
