import React from 'react'

export interface InlineRun {
	text: string
	bold?: boolean
	italic?: boolean
	code?: boolean
	strike?: boolean
}

/**
 * Minimal inline markdown: **bold**, *italic* / _italic_, `code`, ~~strike~~.
 * No nesting inside code. Unmatched markers are left as literal text.
 */
export function parseInline(src: string): InlineRun[] {
	const runs: InlineRun[] = []
	let i = 0
	let buf = ''
	const state = { bold: false, italic: false, strike: false }
	const flush = () => {
		if (buf) runs.push({ text: buf, ...state })
		buf = ''
	}
	const hasClose = (marker: string, from: number) => src.indexOf(marker, from) !== -1

	while (i < src.length) {
		const ch = src[i]
		if (ch === '`') {
			const end = src.indexOf('`', i + 1)
			if (end !== -1) {
				flush()
				runs.push({ text: src.slice(i + 1, end), code: true })
				i = end + 1
				continue
			}
		}
		if (src.startsWith('**', i) && (state.bold || hasClose('**', i + 2))) {
			flush()
			state.bold = !state.bold
			i += 2
			continue
		}
		if (src.startsWith('~~', i) && (state.strike || hasClose('~~', i + 2))) {
			flush()
			state.strike = !state.strike
			i += 2
			continue
		}
		if ((ch === '*' || ch === '_') && (state.italic || hasClose(ch, i + 1))) {
			// avoid treating snake_case as italic: '_' must be at a word boundary
			const prev = src[i - 1]
			const next = src[i + 1]
			const boundary = ch === '*' || state.italic || prev === undefined || /\s/.test(prev) || next !== undefined
			if (boundary && !(ch === '_' && prev && /\w/.test(prev) && next && /\w/.test(next))) {
				flush()
				state.italic = !state.italic
				i += 1
				continue
			}
		}
		buf += ch
		i++
	}
	flush()
	return runs
}

export function hasInlineMarkup(src: string): boolean {
	return /(\*\*|~~|`|\*|_)/.test(src)
}

/** Render runs as React spans. Falls back to plain text when there is no markup. */
export function InlineText({ text, codeFont }: { text: string; codeFont: string }) {
	if (!hasInlineMarkup(text)) return <>{text}</>
	return (
		<>
			{parseInline(text).map((r, i) => (
				<span
					key={i}
					style={{
						fontWeight: r.bold ? 'bold' : undefined,
						fontStyle: r.italic ? 'italic' : undefined,
						textDecoration: r.strike ? 'line-through' : undefined,
						fontFamily: r.code ? codeFont : undefined,
						background: r.code ? 'rgba(127,127,127,0.15)' : undefined,
						borderRadius: r.code ? 3 : undefined,
						padding: r.code ? '0 3px' : undefined,
					}}
				>
					{r.text}
				</span>
			))}
		</>
	)
}
