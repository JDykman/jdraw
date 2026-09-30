import { Editor, TLShapeId, VecLike } from 'tldraw'
import { looksLikeCompose, parseCompose } from './compose'
import type { DiagramGraph } from './graph'
import { insertGraph } from './insertGraph'
import { looksLikeMermaid, parseMermaid } from './mermaid'
import { looksLikeSqlSchema, parseSqlSchema } from './sqlSchema'

export type DiagramSource = 'mermaid' | 'sql' | 'compose'

export const SOURCE_LABELS: Record<DiagramSource, string> = {
	mermaid: 'Mermaid flowchart',
	sql: 'SQL schema',
	compose: 'docker-compose',
}

export function detectDiagramSource(text: string): DiagramSource | null {
	if (looksLikeMermaid(text)) return 'mermaid'
	if (looksLikeSqlSchema(text)) return 'sql'
	if (looksLikeCompose(text)) return 'compose'
	return null
}

export function parseDiagramSource(source: DiagramSource, text: string): DiagramGraph {
	switch (source) {
		case 'mermaid':
			return parseMermaid(text)
		case 'sql':
			return parseSqlSchema(text)
		case 'compose':
			return parseCompose(text)
	}
}

/**
 * Paste hook: if the text is a Mermaid flowchart, SQL DDL or a compose file, draw it and return
 * the created ids. Returns null (so the caller falls back to normal paste) when it isn’t, or fails to parse.
 */
export function tryInsertDiagramText(editor: Editor, text: string, at?: VecLike): TLShapeId[] | null {
	const source = detectDiagramSource(text)
	if (!source) return null
	try {
		return insertGraph(editor, parseDiagramSource(source, text), at)
	} catch (e) {
		console.warn(`Couldn't read pasted ${SOURCE_LABELS[source]}:`, e)
		return null
	}
}
