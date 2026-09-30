import { useMemo, useState } from 'react'
import { Editor } from 'tldraw'
import { formatRelativeTime } from '../pages/pagesApi'
import { $activeThreadId, $commentsPanelOpen, ThreadDto, useComments } from './commentsApi'
import { getThreadPagePoint } from './threadPosition'
import './comments.css'

type Filter = 'open' | 'resolved' | 'mentions'

/** Side panel listing every thread on the page; clicking one zooms to it and opens it. */
export function CommentsPanel({ editor }: { editor: Editor }) {
	const { threads, currentUserId, loaded, error } = useComments()
	const [filter, setFilter] = useState<Filter>('open')

	const visible = useMemo(() => {
		const list = threads.filter((t) => {
			if (filter === 'open') return t.resolvedAt === null
			if (filter === 'resolved') return t.resolvedAt !== null
			return t.comments.some((c) => currentUserId !== undefined && c.mentions.includes(currentUserId))
		})
		return [...list].sort((a, b) => lastActivity(b) - lastActivity(a))
	}, [threads, filter, currentUserId])

	const counts = {
		open: threads.filter((t) => t.resolvedAt === null).length,
		resolved: threads.filter((t) => t.resolvedAt !== null).length,
		mentions: threads.filter((t) => t.comments.some((c) => currentUserId !== undefined && c.mentions.includes(currentUserId))).length,
	}

	const goTo = (thread: ThreadDto) => {
		const p = getThreadPagePoint(editor, thread)
		if (p) editor.centerOnPoint(p, { animation: { duration: 250 } })
		$activeThreadId.set(thread.id)
	}

	return (
		<aside className="comments-panel" aria-label="Comments">
			<div className="comments-panel-head">
				<h3>Comments</h3>
				<button className="comment-icon-btn" onClick={() => $commentsPanelOpen.set(false)} aria-label="Close comments">
					✕
				</button>
			</div>
			<div className="comments-filter" role="group" aria-label="Filter comments">
				{(['open', 'resolved', 'mentions'] as const).map((f) => (
					<button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
						{f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'Mentions me'}
						<span className="comments-filter-count">{counts[f]}</span>
					</button>
				))}
			</div>
			{error && <div className="comment-error">{error}</div>}
			<div className="comments-list">
				{!loaded && !error && <div className="comments-empty">Loading…</div>}
				{loaded && visible.length === 0 && (
					<div className="comments-empty">
						{filter === 'open'
							? 'No open comments. Press Shift+C or right-click a shape to add one.'
							: filter === 'resolved'
								? 'Nothing resolved yet.'
								: 'Nobody has mentioned you here.'}
					</div>
				)}
				{visible.map((t) => {
					const first = t.comments[0]
					const placeable = getThreadPagePoint(editor, t)
					return (
						<button key={t.id} className="comments-row" onClick={() => goTo(t)}>
							<div className="comments-row-head">
								<span className="comment-author">{first?.authorName ?? 'Someone'}</span>
								<span className="comment-time">{formatRelativeTime(lastActivity(t))}</span>
							</div>
							<div className="comments-row-body">{first?.body ?? ''}</div>
							<div className="comments-row-meta">
								{t.comments.length > 1 && <span>{t.comments.length - 1} {t.comments.length === 2 ? 'reply' : 'replies'}</span>}
								{t.shapeId ? <span>{placeable?.shapeMissing ? 'shape deleted' : 'on shape'}</span> : <span>on canvas</span>}
								{t.resolvedAt !== null && <span className="comments-row-resolved">resolved</span>}
							</div>
						</button>
					)
				})}
			</div>
		</aside>
	)
}

function lastActivity(t: ThreadDto) {
	return t.comments.length ? t.comments[t.comments.length - 1].createdAt : t.createdAt
}
