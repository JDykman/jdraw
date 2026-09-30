import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

export interface PageSummary {
	id: string
	name: string
	ownerId: string
	ownerName: string
	isOwner: boolean
	canEdit: boolean
	createdAt: number
	updatedAt: number
	lastEditedAt: number | null
	lastEditedById: string | null
	lastEditedByName: string | null
	lastViewedAt: number | null
	pinned: boolean
	thumbnailUpdatedAt: number | null
	tags: string[]
}

/** Authenticated JSON fetch against the jdraw API. Throws with the server's error message. */
export function useApi() {
	const { getToken } = useAuth()
	return useCallback(
		async <T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
			const { json, headers, ...rest } = init
			const r = await fetch(`/api${path}`, {
				...rest,
				headers: {
					Authorization: `Bearer ${getToken()}`,
					...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
					...headers,
				},
				body: json !== undefined ? JSON.stringify(json) : rest.body,
			})
			if (!r.ok) {
				const data = (await r.json().catch(() => null)) as { error?: string } | null
				throw new Error(data?.error ?? `Request failed (${r.status})`)
			}
			const type = r.headers.get('content-type') ?? ''
			return (type.includes('application/json') ? await r.json() : undefined) as T
		},
		[getToken]
	)
}

export function usePages() {
	const api = useApi()
	const [pages, setPages] = useState<PageSummary[] | null>(null)
	const [error, setError] = useState<string | null>(null)

	const reload = useCallback(async () => {
		try {
			const data = await api<{ pages: PageSummary[] }>('/pages')
			setPages(data.pages)
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [api])

	useEffect(() => {
		reload()
		// Pick up friends' edits when coming back to the tab
		const onFocus = () => reload()
		window.addEventListener('focus', onFocus)
		return () => window.removeEventListener('focus', onFocus)
	}, [reload])

	/** Apply an optimistic local change, run the request, then resync with the server. */
	const mutate = useCallback(
		async (patch: (pages: PageSummary[]) => PageSummary[], request: () => Promise<unknown>) => {
			setPages((p) => (p ? patch(p) : p))
			try {
				await request()
			} catch (e) {
				setError((e as Error).message)
			}
			await reload()
		},
		[reload]
	)

	return { pages, error, setError, reload, mutate, api }
}

/** True when someone else changed the page since the current user last opened it. */
export function hasUnseenEdits(page: PageSummary, userId: string | undefined): boolean {
	if (!page.lastEditedAt || !page.lastEditedById || page.lastEditedById === userId) return false
	return !page.lastViewedAt || page.lastEditedAt > page.lastViewedAt
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(ts: number, now = Date.now()): string {
	const diff = Math.max(0, now - ts)
	if (diff < MINUTE) return 'just now'
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
	if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
	return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
