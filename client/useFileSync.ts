import { useEffect, useRef } from 'react'
import { useEditor } from 'tldraw'

const PAGE_ID = 'default'
const SAVE_DEBOUNCE_MS = 1000

export function useFileSync() {
	const editor = useEditor()
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const isLoading = useRef(true)

	// Load snapshot from file on mount
	useEffect(() => {
		let cancelled = false

		async function load() {
			try {
				const res = await fetch(`/api/pages/${PAGE_ID}`)
				if (res.ok && !cancelled) {
					const snapshot = await res.json()
					editor.loadSnapshot(snapshot)
				}
			} catch {
				// No saved page yet, that's fine
			} finally {
				if (!cancelled) {
					isLoading.current = false
				}
			}
		}

		load()
		return () => {
			cancelled = true
		}
	}, [editor])

	// Auto-save on store changes
	useEffect(() => {
		const removeListener = editor.store.listen(
			() => {
				if (isLoading.current) return

				if (saveTimer.current) {
					clearTimeout(saveTimer.current)
				}

				saveTimer.current = setTimeout(() => {
					const snapshot = editor.getSnapshot()
					fetch(`/api/pages/${PAGE_ID}`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(snapshot),
					}).catch(() => {
						// Save failed silently — server might be down
					})
				}, SAVE_DEBOUNCE_MS)
			},
			{ source: 'user', scope: 'document' }
		)

		return () => {
			removeListener()
			if (saveTimer.current) {
				clearTimeout(saveTimer.current)
			}
		}
	}, [editor])
}
