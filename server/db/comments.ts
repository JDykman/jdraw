import { randomUUID } from 'crypto'
import { db } from './db.js'

export interface CommentDto {
	id: string
	threadId: string
	authorId: string | null
	authorName: string | null
	body: string
	createdAt: number
	editedAt: number | null
	mentions: string[]
}

export interface ThreadDto {
	id: string
	pageId: string
	shapeId: string | null
	anchorX: number
	anchorY: number
	lastX: number | null
	lastY: number | null
	resolvedAt: number | null
	resolvedBy: string | null
	resolvedByName: string | null
	createdBy: string | null
	createdByName: string | null
	createdAt: number
	comments: CommentDto[]
}

export interface MentionableUser {
	id: string
	username: string
	hasAccess: boolean
}

export interface UnreadCounts {
	unread: number
	mentions: number
}

export const MAX_COMMENT_LENGTH = 4000

interface ThreadRow {
	id: string
	page_id: string
	shape_id: string | null
	anchor_x: number
	anchor_y: number
	last_x: number | null
	last_y: number | null
	resolved_at: number | null
	resolved_by: string | null
	resolved_by_name: string | null
	created_by: string | null
	created_by_name: string | null
	created_at: number
}

interface CommentRow {
	id: string
	thread_id: string
	author_id: string | null
	author_name: string | null
	body: string
	created_at: number
	edited_at: number | null
}

const THREAD_SELECT = `SELECT t.id, t.page_id, t.shape_id, t.anchor_x, t.anchor_y, t.last_x, t.last_y,
	t.resolved_at, t.resolved_by, r.username AS resolved_by_name, t.created_by, c.username AS created_by_name, t.created_at
	FROM comment_threads t
	LEFT JOIN users r ON r.id = t.resolved_by
	LEFT JOIN users c ON c.id = t.created_by`

const COMMENT_SELECT = `SELECT c.id, c.thread_id, c.author_id, u.username AS author_name, c.body, c.created_at, c.edited_at
	FROM comments c LEFT JOIN users u ON u.id = c.author_id`

function toThread(row: ThreadRow, comments: CommentDto[] = []): ThreadDto {
	return {
		id: row.id,
		pageId: row.page_id,
		shapeId: row.shape_id,
		anchorX: row.anchor_x,
		anchorY: row.anchor_y,
		lastX: row.last_x,
		lastY: row.last_y,
		resolvedAt: row.resolved_at,
		resolvedBy: row.resolved_by,
		resolvedByName: row.resolved_by_name,
		createdBy: row.created_by,
		createdByName: row.created_by_name,
		createdAt: row.created_at,
		comments,
	}
}

function toComment(row: CommentRow, mentions: string[]): CommentDto {
	return {
		id: row.id,
		threadId: row.thread_id,
		authorId: row.author_id,
		authorName: row.author_name,
		body: row.body,
		createdAt: row.created_at,
		editedAt: row.edited_at,
		mentions,
	}
}

/** Every user, flagged with whether they can see the page (owner or share). */
export function listMentionableUsers(pageId: string): MentionableUser[] {
	const rows = db
		.prepare(
			`SELECT u.id, u.username,
			        CASE WHEN p.owner_id = u.id OR s.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_access
			 FROM users u
			 LEFT JOIN pages p ON p.id = @pageId
			 LEFT JOIN page_shares s ON s.page_id = @pageId AND s.user_id = u.id
			 ORDER BY u.username`
		)
		.all({ pageId }) as { id: string; username: string; has_access: number }[]
	return rows.map((r) => ({ id: r.id, username: r.username, hasAccess: r.has_access === 1 }))
}

const MENTION_PATTERN = /@([^\s@]+)/g

/**
 * User ids for the @username tokens in a body, restricted to users with access to the page.
 * Mentioning someone without access is allowed in the text but doesn't resolve (or notify).
 */
export function resolveMentions(pageId: string, body: string): string[] {
	const names = new Set<string>()
	for (const match of body.matchAll(MENTION_PATTERN)) {
		// Trailing punctuation isn't part of a name ("thanks @bob!")
		names.add(match[1].replace(/[.,;:!?)]+$/, '').toLowerCase())
	}
	if (names.size === 0) return []
	const users = listMentionableUsers(pageId).filter((u) => u.hasAccess)
	const ids: string[] = []
	for (const user of users) {
		if (names.has(user.username.toLowerCase())) ids.push(user.id)
	}
	return ids
}

export function listThreads(pageId: string): ThreadDto[] {
	const threadRows = db.prepare(`${THREAD_SELECT} WHERE t.page_id = ? ORDER BY t.created_at`).all(pageId) as ThreadRow[]
	const commentRows = db
		.prepare(
			`${COMMENT_SELECT} WHERE c.thread_id IN (SELECT id FROM comment_threads WHERE page_id = ?)
			 ORDER BY c.created_at, c.rowid`
		)
		.all(pageId) as CommentRow[]
	const mentionRows = db
		.prepare(
			`SELECT m.comment_id, m.user_id FROM comment_mentions m
			 JOIN comments c ON c.id = m.comment_id
			 WHERE c.thread_id IN (SELECT id FROM comment_threads WHERE page_id = ?)`
		)
		.all(pageId) as { comment_id: string; user_id: string }[]

	const mentionsByComment = new Map<string, string[]>()
	for (const m of mentionRows) {
		const list = mentionsByComment.get(m.comment_id) ?? []
		list.push(m.user_id)
		mentionsByComment.set(m.comment_id, list)
	}
	const threads = new Map<string, ThreadDto>()
	for (const row of threadRows) threads.set(row.id, toThread(row))
	for (const row of commentRows) {
		threads.get(row.thread_id)?.comments.push(toComment(row, mentionsByComment.get(row.id) ?? []))
	}
	return [...threads.values()]
}

export function getThread(pageId: string, threadId: string): ThreadDto | null {
	const row = db.prepare(`${THREAD_SELECT} WHERE t.page_id = ? AND t.id = ?`).get(pageId, threadId) as ThreadRow | undefined
	if (!row) return null
	const comments = db.prepare(`${COMMENT_SELECT} WHERE c.thread_id = ? ORDER BY c.created_at, c.rowid`).all(threadId) as CommentRow[]
	const mentions = db
		.prepare(`SELECT m.comment_id, m.user_id FROM comment_mentions m JOIN comments c ON c.id = m.comment_id WHERE c.thread_id = ?`)
		.all(threadId) as { comment_id: string; user_id: string }[]
	return toThread(
		row,
		comments.map((c) => toComment(c, mentions.filter((m) => m.comment_id === c.id).map((m) => m.user_id)))
	)
}

export function getComment(pageId: string, commentId: string): (CommentDto & { pageId: string }) | null {
	const row = db
		.prepare(
			`${COMMENT_SELECT} JOIN comment_threads t ON t.id = c.thread_id WHERE t.page_id = ? AND c.id = ?`
		)
		.get(pageId, commentId) as CommentRow | undefined
	if (!row) return null
	const mentions = db.prepare('SELECT user_id FROM comment_mentions WHERE comment_id = ?').all(commentId) as { user_id: string }[]
	return { ...toComment(row, mentions.map((m) => m.user_id)), pageId }
}

function insertComment(pageId: string, threadId: string, authorId: string, body: string, now: number): string {
	const id = randomUUID()
	db.prepare('INSERT INTO comments (id, thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
		id,
		threadId,
		authorId,
		body,
		now
	)
	const insertMention = db.prepare('INSERT OR IGNORE INTO comment_mentions (comment_id, user_id) VALUES (?, ?)')
	for (const userId of resolveMentions(pageId, body)) insertMention.run(id, userId)
	return id
}

export function createThread(input: {
	pageId: string
	shapeId: string | null
	anchorX: number
	anchorY: number
	lastX: number | null
	lastY: number | null
	body: string
	authorId: string
}): ThreadDto {
	const now = Date.now()
	const threadId = randomUUID()
	db.transaction(() => {
		db.prepare(
			`INSERT INTO comment_threads (id, page_id, shape_id, anchor_x, anchor_y, last_x, last_y, created_by, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(threadId, input.pageId, input.shapeId, input.anchorX, input.anchorY, input.lastX, input.lastY, input.authorId, now)
		insertComment(input.pageId, threadId, input.authorId, input.body, now)
	})()
	return getThread(input.pageId, threadId)!
}

export function addComment(pageId: string, threadId: string, authorId: string, body: string): CommentDto {
	const id = insertComment(pageId, threadId, authorId, body, Date.now())
	return getComment(pageId, id)!
}

export function updateCommentBody(pageId: string, commentId: string, body: string): CommentDto {
	db.transaction(() => {
		db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, Date.now(), commentId)
		db.prepare('DELETE FROM comment_mentions WHERE comment_id = ?').run(commentId)
		const insertMention = db.prepare('INSERT OR IGNORE INTO comment_mentions (comment_id, user_id) VALUES (?, ?)')
		for (const userId of resolveMentions(pageId, body)) insertMention.run(commentId, userId)
	})()
	return getComment(pageId, commentId)!
}

/** Delete a comment; a thread left with no comments is removed too. Returns true if the thread went. */
export function deleteComment(threadId: string, commentId: string): { threadDeleted: boolean } {
	return db.transaction(() => {
		db.prepare('DELETE FROM comments WHERE id = ?').run(commentId)
		const remaining = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE thread_id = ?').get(threadId) as { n: number }).n
		if (remaining === 0) {
			db.prepare('DELETE FROM comment_threads WHERE id = ?').run(threadId)
			return { threadDeleted: true }
		}
		return { threadDeleted: false }
	})()
}

export function deleteThread(threadId: string) {
	db.prepare('DELETE FROM comment_threads WHERE id = ?').run(threadId)
}

export function setThreadResolved(threadId: string, resolved: boolean, userId: string) {
	if (resolved) {
		db.prepare('UPDATE comment_threads SET resolved_at = ?, resolved_by = ? WHERE id = ?').run(Date.now(), userId, threadId)
	} else {
		db.prepare('UPDATE comment_threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(threadId)
	}
}

export function updateThreadPosition(threadId: string, lastX: number, lastY: number) {
	db.prepare('UPDATE comment_threads SET last_x = ?, last_y = ? WHERE id = ?').run(lastX, lastY, threadId)
}

export function markPageRead(userId: string, pageId: string, now = Date.now()) {
	db.prepare(
		`INSERT INTO comment_reads (user_id, page_id, last_read_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id, page_id) DO UPDATE SET last_read_at = excluded.last_read_at`
	).run(userId, pageId, now)
}

/**
 * Per page the user can access: comments by other people newer than the user's last read, and
 * how many of those mention the user. Pages without unread comments are absent.
 */
export function getUnreadCounts(userId: string): Map<string, UnreadCounts> {
	const rows = db
		.prepare(
			`SELECT t.page_id,
			        COUNT(*) AS unread,
			        SUM(CASE WHEN m.user_id IS NOT NULL THEN 1 ELSE 0 END) AS mentions
			 FROM comments c
			 JOIN comment_threads t ON t.id = c.thread_id
			 JOIN pages p ON p.id = t.page_id
			 LEFT JOIN page_shares s ON s.page_id = t.page_id AND s.user_id = @userId
			 LEFT JOIN comment_reads r ON r.page_id = t.page_id AND r.user_id = @userId
			 LEFT JOIN comment_mentions m ON m.comment_id = c.id AND m.user_id = @userId
			 WHERE (p.owner_id = @userId OR s.user_id IS NOT NULL)
			   AND (c.author_id IS NULL OR c.author_id != @userId)
			   AND (r.last_read_at IS NULL OR c.created_at > r.last_read_at)
			 GROUP BY t.page_id`
		)
		.all({ userId }) as { page_id: string; unread: number; mentions: number }[]
	return new Map(rows.map((r) => [r.page_id, { unread: r.unread, mentions: r.mentions }]))
}
