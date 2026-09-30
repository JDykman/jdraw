import { useEffect } from 'react'
import { useEditor } from 'tldraw'
import { clearPendingTemplate, getPendingTemplate } from './templates'

/** Builds the template chosen in the new-page dialog, once, if the page is still empty. */
export function TemplateApplier({ pageId }: { pageId: string }) {
	const editor = useEditor()

	useEffect(() => {
		const template = getPendingTemplate(pageId)
		if (!template) return
		// Let the synced document settle first so we don't draw over content that just arrived.
		// Only consume the template once the timer fires (StrictMode mounts effects twice).
		const timer = setTimeout(() => {
			clearPendingTemplate(pageId)
			if (!template.apply || editor.getCurrentPageShapeIds().size > 0) return
			editor.run(() => template.apply!(editor))
			editor.selectNone()
		}, 300)
		return () => clearTimeout(timer)
	}, [editor, pageId])

	return null
}
