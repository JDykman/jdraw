import type { DiagramEdge, DiagramGraph, Direction, GeoNode, NodeShape } from './graph'

/**
 * Mermaid flowchart support (the `graph` / `flowchart` diagram type).
 *
 * Handles: direction, node shapes, quoted/unquoted labels, `A --> B --> C` chains, `A & B --> C`,
 * edge labels (`-->|x|` and `-- x -->`), dashed (`-.->`), thick (`==>`), no-head (`---`),
 * circle/cross heads (`--o`, `--x`), bidirectional (`<-->`) and `:::class` suffixes.
 * Ignored: subgraph/end, style, classDef, class, click, linkStyle and comments (`%%`).
 */

export function looksLikeMermaid(text: string): boolean {
	return /^\s*(?:%%[^\n]*\n\s*)*(?:graph|flowchart)(?:\s+(?:TB|TD|BT|LR|RL))?\s*(?:;|\n|$)/i.test(text)
}

// Opening token → [closing token, tldraw geo]. Longest openings first so `((` wins over `(`.
const NODE_SHAPES: [string, string, NodeShape][] = [
	['(((', ')))', 'ellipse'],
	['((', '))', 'ellipse'],
	['([', '])', 'oval'],
	['[[', ']]', 'rectangle'],
	['[(', ')]', 'rectangle'],
	['{{', '}}', 'hexagon'],
	['[/', '/]', 'rhombus'],
	['[\\', '\\]', 'rhombus-2'],
	['[/', '\\]', 'trapezoid'],
	['[', ']', 'rectangle'],
	['(', ')', 'rectangle'],
	['{', '}', 'diamond'],
	['>', ']', 'rectangle'],
]

const IGNORED_LINE = /^(subgraph\b|end\b|style\b|classDef\b|class\b|click\b|linkStyle\b|direction\b)/i

class Cursor {
	i = 0
	constructor(readonly s: string) {}
	get done() {
		return this.i >= this.s.length
	}
	skipSpace() {
		while (!this.done && /\s/.test(this.s[this.i])) this.i++
	}
	startsWith(t: string) {
		return this.s.startsWith(t, this.i)
	}
	rest() {
		return this.s.slice(this.i)
	}
}

function decodeLabel(raw: string): string {
	let t = raw.trim()
	if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1)
	return t
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/#quot;/g, '"')
		.replace(/#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/`/g, '')
		.trim()
}

interface ParsedNodeRef {
	id: string
	label?: string
	shape?: NodeShape
}

function parseNodeRef(c: Cursor): ParsedNodeRef | null {
	c.skipSpace()
	const m = /^[A-Za-z0-9_][\w-]*/.exec(c.rest())
	if (!m) return null
	// Don't swallow the start of an edge like `A--B` or `A-.->B`
	let id = m[0]
	const edgeStart = id.search(/--|-\.|==/)
	if (edgeStart > 0) id = id.slice(0, edgeStart)
	id = id.replace(/-+$/, '')
	if (!id) return null
	c.i += id.length

	let label: string | undefined
	let shape: NodeShape | undefined
	for (const [open, close, geo] of NODE_SHAPES) {
		if (!c.startsWith(open)) continue
		const start = c.i + open.length
		let end: number
		if (c.s[start] === '"') {
			const q = c.s.indexOf('"', start + 1)
			end = q === -1 ? -1 : c.s.indexOf(close, q + 1)
		} else {
			end = c.s.indexOf(close, start)
		}
		if (end === -1) continue
		label = decodeLabel(c.s.slice(start, end))
		shape = geo
		c.i = end + close.length
		break
	}
	// Class shorthand: A:::important
	const cls = /^:::[\w-]+/.exec(c.rest())
	if (cls) c.i += cls[0].length
	return { id, label, shape }
}

interface ParsedEdge {
	label?: string
	dashed: boolean
	thick: boolean
	head: DiagramEdge['head']
	tail: DiagramEdge['tail']
}

const HEAD_OF = (ch: string | undefined): DiagramEdge['head'] =>
	ch === '>' ? 'arrow' : ch === 'o' ? 'dot' : ch === 'x' ? 'bar' : 'none'

function edgeStyle(token: string, label?: string): ParsedEdge {
	const tailCh = token[0] === '<' ? '<' : token[0] === 'o' || token[0] === 'x' ? token[0] : undefined
	const last = token[token.length - 1]
	return {
		label,
		dashed: token.includes('.'),
		thick: token.includes('='),
		head: HEAD_OF(last === '-' || last === '=' || last === '.' ? undefined : last),
		tail: tailCh === '<' ? 'arrow' : tailCh ? HEAD_OF(tailCh) : 'none',
	}
}

// `A -- label --> B`, `A -. label .-> B`, `A == label ==> B`
const LABELED_EDGE = /^(<?)(--|==|-\.)(?![-=.>ox]\s)(?![->=.])\s*([^\n]+?)\s*(-{2,}>|={2,}>|\.-+>|-{3,}|={3,}|\.-+|-{2,}[ox]|={2,}[ox])/
// `-->`, `---`, `-.->`, `==>`, `<-->`, `--o`, `--x`, `x--x`
const PLAIN_EDGE = /^([<ox]?)(-{2,}|={2,}|-\.+-)([>ox]?)(?=[\s|A-Za-z0-9_"]|$)/

function parseEdge(c: Cursor): ParsedEdge | null {
	c.skipSpace()
	const rest = c.rest()
	let m = LABELED_EDGE.exec(rest)
	if (m) {
		c.i += m[0].length
		return edgeStyle(`${m[1]}${m[2]}${m[4]}`, decodeLabel(m[3]))
	}
	m = PLAIN_EDGE.exec(rest)
	if (!m) return null
	c.i += m[0].length
	const style = edgeStyle(`${m[1]}${m[2]}${m[3]}`)
	c.skipSpace()
	// Pipe label: -->|text|
	if (c.startsWith('|')) {
		const end = c.s.indexOf('|', c.i + 1)
		if (end !== -1) {
			style.label = decodeLabel(c.s.slice(c.i + 1, end))
			c.i = end + 1
		}
	}
	return style
}

function parseNodeGroup(c: Cursor): ParsedNodeRef[] | null {
	const first = parseNodeRef(c)
	if (!first) return null
	const group = [first]
	for (;;) {
		const save = c.i
		c.skipSpace()
		if (!c.startsWith('&')) {
			c.i = save
			return group
		}
		c.i++
		const next = parseNodeRef(c)
		if (!next) {
			c.i = save
			return group
		}
		group.push(next)
	}
}

export class MermaidParseError extends Error {}

export function parseMermaid(text: string): DiagramGraph {
	const lines = text
		.replace(/%%[^\n]*/g, '')
		.split(/\n|;/)
		.map((l) => l.trim())
		.filter(Boolean)
	if (lines.length === 0) throw new MermaidParseError('Empty diagram')

	const header = /^(graph|flowchart)(?:\s+(TB|TD|BT|LR|RL))?\s*$/i.exec(lines[0])
	if (!header) {
		const kind = lines[0].split(/\s/)[0]
		throw new MermaidParseError(`Only flowcharts are supported (got “${kind}”)`)
	}
	const dirRaw = (header[2] ?? 'TB').toUpperCase()
	const direction = (dirRaw === 'TD' ? 'TB' : dirRaw) as Direction

	const nodes = new Map<string, GeoNode>()
	const edges: DiagramEdge[] = []

	const touch = (ref: ParsedNodeRef) => {
		const existing = nodes.get(ref.id)
		if (existing) {
			// A later definition with a label/shape wins over a bare reference
			if (ref.label !== undefined) existing.label = ref.label
			if (ref.shape) existing.shape = ref.shape
		} else {
			nodes.set(ref.id, { kind: 'geo', id: ref.id, label: ref.label ?? ref.id, shape: ref.shape ?? 'rectangle' })
		}
	}

	for (const line of lines.slice(1)) {
		if (IGNORED_LINE.test(line)) continue
		const c = new Cursor(line)
		let left = parseNodeGroup(c)
		if (!left) continue
		left.forEach(touch)
		for (;;) {
			const edge = parseEdge(c)
			if (!edge) break
			const right = parseNodeGroup(c)
			if (!right) break
			right.forEach(touch)
			for (const a of left) {
				for (const b of right) {
					edges.push({
						from: a.id,
						to: b.id,
						label: edge.label || undefined,
						dashed: edge.dashed || undefined,
						thick: edge.thick || undefined,
						head: edge.head,
						tail: edge.tail,
					})
				}
			}
			left = right
		}
	}

	if (nodes.size === 0) throw new MermaidParseError('No nodes found')
	return { direction, nodes: [...nodes.values()], edges }
}

// ---------------------------------------------------------------------------
// Export

const SHAPE_BRACKETS: Partial<Record<NodeShape, [string, string]>> = {
	rectangle: ['[', ']'],
	ellipse: ['((', '))'],
	oval: ['([', '])'],
	diamond: ['{', '}'],
	hexagon: ['{{', '}}'],
	rhombus: ['[/', '/]'],
	'rhombus-2': ['[\\', '\\]'],
	trapezoid: ['[/', '\\]'],
}

function encodeLabel(label: string): string {
	return `"${label.replace(/"/g, '#quot;').replace(/\n/g, '<br/>')}"`
}

function edgeToken(e: DiagramEdge): string {
	const body = e.thick ? '==' : e.dashed ? '-.-' : '--'
	const head = e.head === 'arrow' ? '>' : e.head === 'dot' ? 'o' : e.head === 'bar' ? 'x' : e.dashed ? '' : '-'
	const tail = e.tail === 'arrow' ? '<' : e.tail === 'dot' ? 'o' : e.tail === 'bar' ? 'x' : ''
	// `-.-` already ends in a dash, so a headless dashed edge is complete
	return `${tail}${body}${head === '-' && e.thick ? '=' : head}`
}

export function toMermaid(graph: DiagramGraph): string {
	const out = [`flowchart ${graph.direction === 'TB' ? 'TD' : graph.direction}`]
	for (const n of graph.nodes) {
		if (n.kind !== 'geo') continue
		const [open, close] = SHAPE_BRACKETS[n.shape] ?? ['[', ']']
		out.push(`    ${n.id}${open}${encodeLabel(n.label)}${close}`)
	}
	for (const e of graph.edges) {
		const label = e.label ? `|${encodeLabel(e.label)}|` : ''
		out.push(`    ${e.from} ${edgeToken(e)}${label} ${e.to}`)
	}
	return out.join('\n')
}
