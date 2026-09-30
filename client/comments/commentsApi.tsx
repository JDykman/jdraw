import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { atom } from 'tldraw'
import { useAuth } from '../auth/AuthContext'
import { useApi } from '../pages/pagesApi'
import { subscribeCustomSyncMessages } from './commentsBus'

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

/** Where a new thread is about to be created (after clicking with the comment tool). */
export interface PendingComment {
	shapeId: string | null
	anchorX: number
	anchorY: number
	pageX: number
	pageY: number
}

// UI state shared between the canvas overlay (inside tldraw) and the App-level panel/buttons.
export const $commentsPanelOpen = atom('comments panel open', false)
export const $activeThreadId = atom<string | null>('active comment thread', null)
export const $pendingComment = atom<PendingComment | null>('pending comment', null)
export const $openThreadCount = atom('open comment thread count', 0)

interface ThreadsResponse {
	threads: ThreadDto[]
	users: MentionableUser[]
	canEdit: boolean
	isOwner: boolean
}

export interface CommentsContextValue {
	pageId: string
	currentUserId: string | undefined
	threads: ThreadDto[]
	users: MentionableUser[]
	canEdit: boolean
	isOwner: boolean
	loaded: boolean
	error: string | null
	reload(): Promise<void>
	createThread(input: PendingComment & { body: string }): Promise<ThreadDto>
	reply(threadId: string, body: string): Promise<void>
	editComment(commentId: string, body: string): Promise<void>
	deleteComment(commentId: string): Promise<void>
	deleteThread(threadId: string): Promise<void>
	setResolved(threadId: string, resolved: boolean): Promise<void>
	updatePosition(threadId: string, lastX: number, lastY: number): Promise<void>
	markRead(): void
}

const CommentsContext = createContext<CommentsContextValue | null>(null)

export function useComments(): CommentsContextValue {
	const ctx = useContext(CommentsContext)
	if (!ctx) throw new Error('useComments must be used inside CommentsProvider')
	return ctx
}

/** Loads a page's comment threads and keeps them fresh from the sync socket's custom messages. */
export function CommentsProvider({ pageId, children }: { pageId: string; children: ReactNode }) {
	const api = useApi()
	const { user } = useAuth()
	const [state, setState] = useState<ThreadsResponse | null>(null)
	const [error, setError] = useState<string | null>(null)
	const lastReadRef = useRef(0)

	const reload = useCallback(async () => {
		try {
			const data = await api<ThreadsResponse>(`/pages/${pageId}/comments`)
			setState(data)
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [api, pageId])

	const markRead = useCallback(() => {
		// Several triggers can fire together (mount, panel open, live update); one request a second is plenty
		const now = Date.now()
		if (now - lastReadRef.current < 1000) return
		lastReadRef.current = now
		api(`/pages/${pageId}/comments/read`, { method: 'POST' }).catch(() => {})
	}, [api, pageId])

	useEffect(() => {
		reload()
		return subscribeCustomSyncMessages((message) => {
			if (message.type !== 'comments-changed' || message.pageId !== pageId) return
			reload().then(() => {
				// The user is looking at the page, so what just arrived counts as seen
				if (document.visibilityState === 'visible') markRead()
			})
		})
	}, [pageId, reload, markRead])

	useEffect(() => {
		$openThreadCount.set(state ? state.threads.filter((t) => t.resolvedAt === null).length : 0)
	}, [state])

	useEffect(() => {
		return () => {
			$openThreadCount.set(0)
			$activeThreadId.set(null)
			$pendingComment.set(null)
		}
	}, [pageId])

	const value = useMemo<CommentsContextValue>(() => {
		const base = `/pages/${pageId}/comments`
		return {
			pageId,
			currentUserId: user?.id,
			threads: state?.threads ?? [],
			users: state?.users ?? [],
			canEdit: state?.canEdit ?? false,
			isOwner: state?.isOwner ?? false,
			loaded: state !== null,
			error,
			reload,
			markRead,
			async createThread(input) {
				const thread = await api<ThreadDto>(`${base}/threads`, {
					method: 'POST',
					json: {
						shapeId: input.shapeId,
						anchorX: input.anchorX,
						anchorY: input.anchorY,
						lastX: input.pageX,
						lastY: input.pageY,
						body: input.body,
					},
				})
				await reload()
				return thread
			},
			async reply(threadId, body) {
				await api(`${base}/threads/${threadId}/comments`, { method: 'POST', json: { body } })
				await reload()
			},
			async editComment(commentId, body) {
				await api(`${base}/${commentId}`, { method: 'PATCH', json: { body } })
				await reload()
			},
			async deleteComment(commentId) {
				await api(`${base}/${commentId}`, { method: 'DELETE' })
				await reload()
			},
			async deleteThread(threadId) {
				await api(`${base}/threads/${threadId}`, { method: 'DELETE' })
				await reload()
			},
			async setResolved(threadId, resolved) {
				await api(`${base}/threads/${threadId}`, { method: 'PATCH', json: { resolved } })
				await reload()
			},
			async updatePosition(threadId, lastX, lastY) {
				// Local first so the periodic sync doesn't resend the same position
				setState((s) =>
					s ? { ...s, threads: s.threads.map((t) => (t.id === threadId ? { ...t, lastX, lastY } : t)) } : s
				)
				await api(`${base}/threads/${threadId}`, { method: 'PATCH', json: { lastX, lastY } })
			},
		}
	}, [api, pageId, user?.id, state, error, reload, markRead])

	return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}
