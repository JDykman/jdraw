import { useEffect } from 'react'
import { useEditor, useValue } from 'tldraw'
import { $activeThreadId, $commentsPanelOpen, $pendingComment, useComments } from './commentsApi'
import { DraftPopover, ThreadPopover } from './ThreadPopover'
import { getThreadPagePoint } from './threadPosition'
import './comments.css'

const POSITION_SYNC_INTERVAL_MS = 3000

// Page point of the last right-click on the canvas, for "Add comment" in the context menu
let lastContextMenuPagePoint: { x: number; y: number } | null = null
export function getLastContextMenuPagePoint() {
	return lastContextMenuPagePoint
}

/**
 * Comment markers over the canvas plus the thread / new-comment popovers. Rendered inside
 * tldraw's InFrontOfTheCanvas so it has the editor; positions are reactive to the camera and to
 * shape moves through useValue.
 */
export function CommentsOverlay() {
	const editor = useEditor()
	const { threads, canEdit, updatePosition, markRead } = useComments()
	const activeId = useValue($activeThreadId)
	const panelOpen = useValue($commentsPanelOpen)

	// Opening the page counts as reading its comments
	useEffect(() => markRead(), [markRead])
	useEffect(() => {
		if (panelOpen) markRead()
	}, [panelOpen, markRead])

	useEffect(() => {
		const onContextMenu = (e: MouseEvent) => {
			if (!(e.target as Element | null)?.closest('.tl-canvas')) return
			lastContextMenuPagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY })
		}
		document.addEventListener('contextmenu', onContextMenu, true)
		return () => document.removeEventListener('contextmenu', onContextMenu, true)
	}, [editor])

	// Keep last_x/last_y close to where a pinned shape actually is, so a deleted shape's thread
	// doesn't jump back to a stale spot. Only editors move shapes, so only they report.
	useEffect(() => {
		if (!canEdit) return
		const tick = () => {
			for (const t of threads) {
				if (!t.shapeId) continue
				const p = getThreadPagePoint(editor, t)
				if (!p || p.shapeMissing) continue
				if (t.lastX === null || t.lastY === null || Math.abs(p.x - t.lastX) > 0.5 || Math.abs(p.y - t.lastY) > 0.5) {
					updatePosition(t.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100).catch(() => {})
				}
			}
		}
		const interval = setInterval(tick, POSITION_SYNC_INTERVAL_MS)
		return () => clearInterval(interval)
	}, [editor, threads, canEdit, updatePosition])

	// Escape closes whatever is open
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return
			if ($pendingComment.get()) $pendingComment.set(null)
			else if ($activeThreadId.get()) $activeThreadId.set(null)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	const markers = useValue(
		'comment markers',
		() =>
			threads
				.filter((t) => t.resolvedAt === null || t.id === activeId)
				.map((t) => {
					const p = getThreadPagePoint(editor, t)
					if (!p) return null
					const v = editor.pageToViewport(p)
					return { thread: t, x: v.x, y: v.y, shapeMissing: p.shapeMissing }
				})
				.filter((m): m is NonNullable<typeof m> => m !== null),
		[editor, threads, activeId]
	)

	const active = activeId ? threads.find((t) => t.id === activeId) ?? null : null

	return (
		<>
			<div className="comment-markers">
				{markers.map(({ thread, x, y, shapeMissing }) => {
					const first = thread.comments[0]
					const initial = (first?.authorName ?? '?').slice(0, 1).toUpperCase()
					return (
						<button
							key={thread.id}
							className={`comment-marker${thread.id === activeId ? ' comment-marker--active' : ''}${
								thread.resolvedAt !== null ? ' comment-marker--resolved' : ''
							}${shapeMissing ? ' comment-marker--orphan' : ''}`}
							style={{ transform: `translate(${x}px, ${y}px)` }}
							title={first ? `${first.authorName ?? 'Someone'}: ${first.body.slice(0, 80)}` : 'Comment'}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => {
								$pendingComment.set(null)
								$activeThreadId.set(thread.id === activeId ? null : thread.id)
							}}
						>
							<span className="comment-marker-initial">{initial}</span>
							{thread.comments.length > 1 && <span className="comment-marker-count">{thread.comments.length}</span>}
						</button>
					)
				})}
			</div>
			{active && <ThreadPopover editor={editor} thread={active} />}
			<DraftPopover editor={editor} />
		</>
	)
}
