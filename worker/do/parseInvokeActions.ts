/**
 * Newer Claude models sometimes answer in their native tool-call markup instead of the JSON
 * action list:
 *
 *   <invoke name="create">
 *     <parameter name="intent">Mobile box</parameter>
 *     <parameter name="shape">{"_type":"rectangle", ...}</parameter>
 *   </invoke>
 *
 * This reads that into action objects. It works on partial (still streaming) text: the last
 * invoke may be unfinished, in which case only its completed parameters (plus a partial
 * string value) are returned.
 */

// Parameters that are always plain text, even when they look like numbers or JSON
const STRING_PARAMS = new Set(['text', 'intent', 'title', 'label', 'note', 'name', 'message'])

const INVOKE_OPEN = /<(?:[\w-]+:)?invoke\s+name="([^"]+)"\s*>/g
const PARAM = /<(?:[\w-]+:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)(<\/(?:[\w-]+:)?parameter>|$)/g
const INVOKE_CLOSE = /<\/(?:[\w-]+:)?invoke>/

export function looksLikeInvokeMarkup(text: string): boolean {
	const invoke = text.search(/<(?:[\w-]+:)?invoke\s+name=/)
	if (invoke === -1) return false
	const json = text.search(/\{\s*"actions"/)
	return json === -1 || invoke < json
}

function decodeEntities(s: string): string {
	return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function parseValue(name: string, raw: string, complete: boolean): unknown {
	const value = decodeEntities(raw.trim())
	if (STRING_PARAMS.has(name)) return value
	if (!complete) {
		// Half-streamed JSON isn't usable yet; half-streamed text is
		return /^[[{]/.test(value) ? undefined : value
	}
	if (/^[[{]/.test(value) || /^-?\d+(\.\d+)?$/.test(value) || /^(true|false|null)$/.test(value)) {
		try {
			return JSON.parse(value)
		} catch {
			return value
		}
	}
	return value
}

export function parseInvokeActions(text: string): Record<string, unknown>[] {
	const actions: Record<string, unknown>[] = []
	const opens = [...text.matchAll(INVOKE_OPEN)]
	opens.forEach((open, i) => {
		const bodyStart = open.index! + open[0].length
		const nextOpen = opens[i + 1]?.index ?? text.length
		let body = text.slice(bodyStart, nextOpen)
		const close = INVOKE_CLOSE.exec(body)
		if (close) body = body.slice(0, close.index)

		const action: Record<string, unknown> = { _type: open[1] }
		for (const p of body.matchAll(PARAM)) {
			const complete = p[3] !== ''
			const value = parseValue(p[1], p[2], complete)
			if (value !== undefined) action[p[1]] = value
		}
		actions.push(action)
	})
	return actions
}
