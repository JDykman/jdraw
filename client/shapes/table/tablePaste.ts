import { createShapeId, defaultHandleExternalTextContent, Editor, TLTextExternalContent } from 'tldraw'
import { TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_ROW_HEIGHT, TLTableShape } from '../../../shared/table/tableShapeProps'
import { parseDelimited } from './tableOps'

/**
 * Pasting tab/comma-separated text onto the canvas creates a table.
 * Anything else falls through to tldraw's default text handler.
 */
export function registerTablePasteHandler(editor: Editor) {
	editor.registerExternalContentHandler('text', async (content: TLTextExternalContent) => {
		const grid = parseDelimited(content.text)
		if (!grid) {
			await defaultHandleExternalTextContent(editor, content)
			return
		}
		const rows = grid.length
		const cols = grid[0].length
		const w = cols * TABLE_DEFAULT_COL_WIDTH
		const h = rows * TABLE_DEFAULT_ROW_HEIGHT
		const p = content.point ?? editor.getViewportPageBounds().center
		const id = createShapeId()
		editor.markHistoryStoppingPoint('paste table')
		editor.createShape<TLTableShape>({
			id,
			type: 'table',
			x: p.x - w / 2,
			y: p.y - h / 2,
			props: {
				w,
				h,
				colWidths: Array(cols).fill(TABLE_DEFAULT_COL_WIDTH),
				rowHeights: Array(rows).fill(TABLE_DEFAULT_ROW_HEIGHT),
				cells: grid,
				headerRow: true,
			},
		})
		editor.select(id)
	})
}

import { registerTableArrowSnapping } from './tableArrowSnap'

/** Everything the table shape needs wired at editor mount. Pass to <Tldraw onMount>. */
export function setupTableShape(editor: Editor) {
	registerTablePasteHandler(editor)
	return registerTableArrowSnapping(editor)
}
