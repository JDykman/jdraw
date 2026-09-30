import { useEffect } from 'react'
import { Editor, useEditor } from 'tldraw'
import { useAuth } from '../auth/AuthContext'

const THUMB_MAX_W = 480
const THUMB_MAX_H = 300
const CAPTURE_INTERVAL_MS = 5 * 60 * 1000
const INITIAL_CAPTURE_DELAY_MS = 3_000

async function captureThumbnail(editor: Editor): Promise<Blob | null> {
	const ids = [...editor.getCurrentPageShapeIds()]
	if (ids.length === 0) return null
	const bounds = editor.getCurrentPageBounds()
	if (!bounds) return null
	const scale = Math.min(1, THUMB_MAX_W / bounds.w, THUMB_MAX_H / bounds.h)
	const { blob } = await editor.toImage(ids, {
		format: 'png',
		scale,
		pixelRatio: 1,
		background: true,
		padding: 24,
		// Cards look consistent regardless of who last had the page open in dark mode
		darkMode: false,
	})
	return blob
}

/**
 * Keeps the homepage thumbnail and "last viewed" time for a page up to date.
 * Captures shortly after opening, every 5 minutes while the document changes, and on leaving.
 * Rendered inside the Tldraw tree so it has the editor.
 */
export function PageThumbnailSync({ pageId }: { pageId: string }) {
	const editor = useEditor()
	const { getToken } = useAuth()

	useEffect(() => {
		let dirty = false
		let disposed = false

		const request = (path: string, init: RequestInit = {}) =>
			fetch(`/api/pages/${pageId}${path}`, {
				...init,
				headers: { Authorization: `Bearer ${getToken()}`, ...init.headers },
			}).catch(() => {})

		const upload = async () => {
			dirty = false
			try {
				const blob = await captureThumbnail(editor)
				if (blob) {
					await request('/thumbnail', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: blob })
				} else {
					await request('/thumbnail', { method: 'DELETE' })
				}
			} catch (e) {
				console.warn('Thumbnail capture failed:', e)
			}
		}

		request('/view', { method: 'POST' })

		const stopListening = editor.store.listen(() => (dirty = true), { scope: 'document' })
		const initial = setTimeout(() => !disposed && upload(), INITIAL_CAPTURE_DELAY_MS)
		const interval = setInterval(() => dirty && upload(), CAPTURE_INTERVAL_MS)

		return () => {
			disposed = true
			stopListening()
			clearTimeout(initial)
			clearInterval(interval)
			// The editor is still alive during unmount cleanup, so the export can run
			if (dirty) upload()
			request('/view', { method: 'POST' })
		}
	}, [editor, pageId, getToken])

	return null
}
