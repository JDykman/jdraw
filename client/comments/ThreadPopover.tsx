import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Editor, useValue } from 'tldraw'
import { formatRelativeTime } from '../pages/pagesApi'
import { $activeThreadId, $pendingComment, CommentDto, ThreadDto, useComments } from './commentsApi'
import { CommentText } from './commentText'
import { MentionTextarea } from './MentionTextarea'
import { getThreadPagePoint } from './threadPosition'

const POPOVER_WIDTH = 320
const MARKER_OFFSET = 18

/** Screen-space placement for a popover anchored at a page point, flipped away from the edges. */
function usePopoverStyle(editor: Editor, pagePoint: { x: number; y: number } | null) {
	return useValue(
		'comment popover position',
		() => {
			if (!pagePoint) return null
			const p = editor.pageToScreen(pagePoint)
			const left = p.x + MARKER_OFFSET + POPOVER_WIDTH > window.innerWidth - 8 ? p.x - MARKER_OFFSET - POPOVER_WIDTH : p.x + MARKER_OFFSET
			const top = Math.max(8, Math.min(p.y - 12, window.innerHeight - 8 - 360))
			return { left, top, width: POPOVER_WIDTH }
		},
		[editor, pagePoint?.x, pagePoint?.y]
	)
}

function CommentItem({ comment, thread }: { comment: CommentDto; thread: ThreadDto }) {
	const { users, currentUserId, isOwner, editComment, deleteComment } = useComments()
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(comment.body)
	const [busy, setBusy] = useState(false)
	const mine = comment.authorId === currentUserId

	const save = async () => {
		if (!draft.trim()) return
		setBusy(true)
		try {
			await editComment(comment.id, draft.trim())
			setEditing(false)
		} finally {
			setBusy(false)
		}
	}

	const remove = async () => {
		const last = thread.comments.length === 1
		if (!confirm(last ? 'Delete this comment? It is the only one, so the thread goes with it.' : 'Delete this comment?')) return
		setBusy(true)
		try {
			await deleteComment(comment.id)
			if (last) $activeThreadId.set(null)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="comment-item">
			<div className="comment-item-head">
				<span className="comment-author">{comment.authorName ?? 'Deleted user'}</span>
				<span className="comment-time">
					{formatRelativeTime(comment.createdAt)}
					{comment.editedAt ? ' · edited' : ''}
				</span>
				{(mine || isOwner) && !editing && (
					<span className="comment-item-actions">
						{mine && (
							<button className="comment-link" onClick={() => setEditing(true)} disabled={busy}>
								Edit
							</button>
						)}
						<button className="comment-link comment-link--danger" onClick={remove} disabled={busy}>
							Delete
						</button>
					</span>
				)}
			</div>
			{editing ? (
				<div className="comment-edit">
					<MentionTextarea value={draft} onChange={setDraft} onSubmit={save} users={users} autoFocus disabled={busy} />
					<div className="comment-actions">
						<button className="comment-btn" onClick={() => (setEditing(false), setDraft(comment.body))} disabled={busy}>
							Cancel
						</button>
						<button className="comment-btn comment-btn--primary" onClick={save} disabled={busy || !draft.trim()}>
							Save
						</button>
					</div>
				</div>
			) : (
				<div className="comment-body">
					<CommentText body={comment.body} users={users} />
				</div>
			)}
		</div>
	)
}

/** The open thread: its comments, resolve/reopen, and a reply box with @mention autocomplete. */
export function ThreadPopover({ editor, thread }: { editor: Editor; thread: ThreadDto }) {
	const { users, isOwner, reply, setResolved, deleteThread, error } = useComments()
	const [draft, setDraft] = useState('')
	const [busy, setBusy] = useState(false)
	const position = useValue('thread page point', () => getThreadPagePoint(editor, thread), [editor, thread])
	const style = usePopoverStyle(editor, position)
	if (!style) return null

	const close = () => $activeThreadId.set(null)
	const resolved = thread.resolvedAt !== null

	const send = async () => {
		const body = draft.trim()
		if (!body) return
		setBusy(true)
		try {
			await reply(thread.id, body)
			setDraft('')
		} finally {
			setBusy(false)
		}
	}

	const toggleResolved = async () => {
		setBusy(true)
		try {
			await setResolved(thread.id, !resolved)
		} finally {
			setBusy(false)
		}
	}

	const removeThread = async () => {
		if (!confirm('Delete this whole thread?')) return
		setBusy(true)
		try {
			await deleteThread(thread.id)
			close()
		} finally {
			setBusy(false)
		}
	}

	return createPortal(
		<div className="comment-popover" style={style} role="dialog" aria-label="Comment thread" onPointerDown={(e) => e.stopPropagation()}>
			<div className="comment-popover-head">
				<span className={`comment-status${resolved ? ' comment-status--resolved' : ''}`}>
					{resolved ? `Resolved by ${thread.resolvedByName ?? 'someone'}` : 'Open'}
				</span>
				<span className="comment-popover-head-actions">
					<button className="comment-link" onClick={toggleResolved} disabled={busy}>
						{resolved ? 'Reopen' : 'Resolve'}
					</button>
					{isOwner && (
						<button className="comment-link comment-link--danger" onClick={removeThread} disabled={busy}>
							Delete thread
						</button>
					)}
					<button className="comment-icon-btn" onClick={close} aria-label="Close thread">
						✕
					</button>
				</span>
			</div>
			{position?.shapeMissing && <div className="comment-hint">The shape this was pinned to was deleted.</div>}
			{error && <div className="comment-error">{error}</div>}
			<div className="comment-list">
				{thread.comments.map((c) => (
					<CommentItem key={c.id} comment={c} thread={thread} />
				))}
			</div>
			<div className="comment-reply">
				<MentionTextarea value={draft} onChange={setDraft} onSubmit={send} users={users} placeholder="Reply… use @ to mention" disabled={busy} />
				<div className="comment-actions">
					<span className="comment-hint-inline">⌘/Ctrl+Enter to send</span>
					<button className="comment-btn comment-btn--primary" onClick={send} disabled={busy || !draft.trim()}>
						Reply
					</button>
				</div>
			</div>
		</div>,
		document.body
	)
}

/** New-thread composer shown where the user clicked with the comment tool. */
export function DraftPopover({ editor }: { editor: Editor }) {
	const pending = useValue($pendingComment)
	const { users, createThread } = useComments()
	const [draft, setDraft] = useState('')
	const [busy, setBusy] = useState(false)
	const pagePoint = pending ? { x: pending.pageX, y: pending.pageY } : null
	const style = usePopoverStyle(editor, pagePoint)
	if (!pending || !style) return null

	const cancel = () => {
		$pendingComment.set(null)
		setDraft('')
	}
	const submit = async () => {
		const body = draft.trim()
		if (!body) return
		setBusy(true)
		try {
			const thread = await createThread({ ...pending, body })
			$pendingComment.set(null)
			setDraft('')
			$activeThreadId.set(thread.id)
		} finally {
			setBusy(false)
		}
	}

	return createPortal(
		<div className="comment-popover" style={style} role="dialog" aria-label="New comment" onPointerDown={(e) => e.stopPropagation()}>
			<div className="comment-popover-head">
				<span className="comment-status">{pending.shapeId ? 'New comment on shape' : 'New comment'}</span>
				<button className="comment-icon-btn" onClick={cancel} aria-label="Cancel comment">
					✕
				</button>
			</div>
			<div className="comment-reply">
				<MentionTextarea value={draft} onChange={setDraft} onSubmit={submit} users={users} placeholder="Comment… use @ to mention" autoFocus disabled={busy} />
				<div className="comment-actions">
					<button className="comment-btn" onClick={cancel} disabled={busy}>
						Cancel
					</button>
					<button className="comment-btn comment-btn--primary" onClick={submit} disabled={busy || !draft.trim()}>
						Comment
					</button>
				</div>
			</div>
		</div>,
		document.body
	)
}
