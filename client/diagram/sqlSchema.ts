import type { DiagramEdge, DiagramGraph, TableNode } from './graph'

/**
 * SQL DDL → ER diagram. Reads CREATE TABLE statements (column + table constraints) and
 * ALTER TABLE … ADD FOREIGN KEY. Each table becomes a table shape with Column / Type / Key
 * columns (the layout "Copy as SQL" recognises), and each foreign key an arrow between rows.
 */

export function looksLikeSqlSchema(text: string): boolean {
	return /\bcreate\s+table\b/i.test(text)
}

interface Column {
	name: string
	type: string
	pk: boolean
	notNull: boolean
	unique: boolean
	ref: { table: string; column: string } | null
}

interface Table {
	name: string
	columns: Column[]
}

function stripComments(sql: string) {
	return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ')
}

/** Text between the paren at `open` and its match. */
function balanced(s: string, open: number): { body: string; end: number } | null {
	let depth = 0
	let quote: string | null = null
	for (let i = open; i < s.length; i++) {
		const ch = s[i]
		if (quote) {
			if (ch === quote) quote = null
			continue
		}
		if (ch === "'" || ch === '"' || ch === '`') quote = ch
		else if (ch === '(') depth++
		else if (ch === ')' && --depth === 0) return { body: s.slice(open + 1, i), end: i }
	}
	return null
}

function splitTopLevel(body: string): string[] {
	const parts: string[] = []
	let depth = 0
	let quote: string | null = null
	let start = 0
	for (let i = 0; i < body.length; i++) {
		const ch = body[i]
		if (quote) {
			if (ch === quote) quote = null
			continue
		}
		if (ch === "'" || ch === '"' || ch === '`') quote = ch
		else if (ch === '(') depth++
		else if (ch === ')') depth--
		else if (ch === ',' && depth === 0) {
			parts.push(body.slice(start, i))
			start = i + 1
		}
	}
	parts.push(body.slice(start))
	return parts.map((p) => p.trim()).filter(Boolean)
}

const IDENT = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`

function unquote(id: string) {
	return id.trim().replace(/^["`[]|["`\]]$/g, '')
}

/** `public.users` → `users` (display and matching use the last segment). */
function lastSegment(qualified: string) {
	const parts = qualified.split('.').map(unquote)
	return parts[parts.length - 1]
}

function identList(s: string) {
	return s.split(',').map((x) => unquote(x.trim()))
}

const COLUMN_KEYWORDS =
	/\s+(?=(?:constraint|primary|not|null|unique|references|default|check|auto_increment|autoincrement|identity|generated|collate|comment|on)\b)/i

function parseColumn(def: string): Column | null {
	const m = new RegExp(`^(${IDENT})\\s+([\\s\\S]*)$`).exec(def)
	if (!m) return null
	const name = unquote(m[1])
	const rest = m[2]
	const typeEnd = rest.search(COLUMN_KEYWORDS)
	const type = (typeEnd === -1 ? rest : rest.slice(0, typeEnd)).trim().replace(/\s+/g, ' ')
	const constraints = typeEnd === -1 ? '' : rest.slice(typeEnd)
	const ref = new RegExp(`references\\s+(${QUALIFIED})\\s*(?:\\(\\s*(${IDENT})\\s*\\))?`, 'i').exec(constraints)
	return {
		name,
		type: type || '?',
		pk: /\bprimary\s+key\b/i.test(constraints),
		notNull: /\bnot\s+null\b/i.test(constraints),
		unique: /\bunique\b/i.test(constraints),
		ref: ref ? { table: lastSegment(ref[1]), column: ref[2] ? unquote(ref[2]) : 'id' } : null,
	}
}

function applyTableConstraint(table: Table, def: string) {
	const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(def)
	if (pk) {
		for (const col of identList(pk[1])) {
			const c = table.columns.find((x) => x.name.toLowerCase() === col.toLowerCase())
			if (c) c.pk = true
		}
	}
	const fk = new RegExp(
		`foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+(${QUALIFIED})\\s*(?:\\(([^)]*)\\))?`,
		'i'
	).exec(def)
	if (fk) {
		const cols = identList(fk[1])
		const refCols = fk[3] ? identList(fk[3]) : cols.map(() => 'id')
		cols.forEach((col, i) => {
			const c = table.columns.find((x) => x.name.toLowerCase() === col.toLowerCase())
			if (c) c.ref = { table: lastSegment(fk[2]), column: refCols[i] ?? 'id' }
		})
	}
	const uq = /^(?:constraint\s+\S+\s+)?unique\s*(?:key|index)?\s*(?:\S+\s*)?\(([^)]*)\)/i.exec(def)
	if (uq) {
		const cols = identList(uq[1])
		// Only single-column uniques map onto a column flag
		if (cols.length === 1) {
			const c = table.columns.find((x) => x.name.toLowerCase() === cols[0].toLowerCase())
			if (c) c.unique = true
		}
	}
}

const TABLE_CONSTRAINT = /^(constraint|primary\s+key|foreign\s+key|unique|check|index|key|fulltext|spatial|exclude)\b/i

export function parseSqlSchema(text: string): DiagramGraph {
	const sql = stripComments(text)
	const tables: Table[] = []
	const createRe = new RegExp(
		`create\\s+(?:(?:global\\s+|local\\s+)?(?:temporary|temp)\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})\\s*\\(`,
		'gi'
	)
	let m: RegExpExecArray | null
	while ((m = createRe.exec(sql))) {
		const group = balanced(sql, m.index + m[0].length - 1)
		if (!group) break
		const table: Table = { name: lastSegment(m[1]), columns: [] }
		const constraints: string[] = []
		for (const part of splitTopLevel(group.body)) {
			if (TABLE_CONSTRAINT.test(part)) constraints.push(part)
			else {
				const col = parseColumn(part)
				if (col) table.columns.push(col)
			}
		}
		constraints.forEach((c) => applyTableConstraint(table, c))
		tables.push(table)
		createRe.lastIndex = group.end
	}

	const alterRe = new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${QUALIFIED})\\s+add\\s+([^;]*)`, 'gi')
	while ((m = alterRe.exec(sql))) {
		const table = tables.find((t) => t.name.toLowerCase() === lastSegment(m![1]).toLowerCase())
		if (table) applyTableConstraint(table, m[2])
	}

	if (tables.length === 0) throw new Error('No CREATE TABLE statements found')

	const nodes: TableNode[] = tables.map((t) => ({
		kind: 'table',
		id: t.name.toLowerCase(),
		title: t.name,
		header: ['Column', 'Type', 'Key'],
		rows: t.columns.map((c) => [c.name, c.type.toLowerCase(), keyCell(c)]),
	}))

	const edges: DiagramEdge[] = []
	for (const t of tables) {
		t.columns.forEach((c, row) => {
			if (!c.ref) return
			const target = tables.find((x) => x.name.toLowerCase() === c.ref!.table.toLowerCase())
			if (!target) return
			const targetRow = target.columns.findIndex((x) => x.name.toLowerCase() === c.ref!.column.toLowerCase())
			edges.push({
				from: t.name.toLowerCase(),
				to: target.name.toLowerCase(),
				fromRow: row,
				toRow: targetRow >= 0 ? targetRow : undefined,
				head: 'arrow',
			})
		})
	}

	return { direction: 'LR', nodes, edges }
}

function keyCell(c: Column): string {
	const parts: string[] = []
	if (c.pk) parts.push('PK')
	if (c.ref) parts.push(`FK → ${c.ref.table}.${c.ref.column}`)
	if (c.unique && !c.pk) parts.push('UNIQUE')
	if (c.notNull && !c.pk) parts.push('NOT NULL')
	return parts.join(', ')
}
