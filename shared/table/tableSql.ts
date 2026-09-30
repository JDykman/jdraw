import type { TLTableShapeProps } from './tableShapeProps'

/**
 * Table → SQL (ANSI-ish, Postgres-friendly).
 *
 * Two layouts are recognised:
 *  - Entity layout: header row contains a "Type" column. Each data row is one column of the SQL
 *    table: name, type, and constraints (PK, FK, UNIQUE, NOT NULL, DEFAULT, auto-increment,
 *    "references x(y)" / "fk x.y" / "→ x.y"). Produces CREATE TABLE.
 *  - Data layout: anything else. Header cells are column names, rows are data. Produces
 *    CREATE TABLE with inferred types plus INSERT.
 */

type TableSqlProps = Pick<TLTableShapeProps, 'cells' | 'headerRow' | 'title' | 'showTitle'>

export interface SqlRef {
	table: string
	column: string
}

export interface SqlTableInput {
	props: TableSqlProps
	/** Extra foreign keys by data-row index into props.cells (e.g. from arrows between rows). */
	refs?: Map<number, SqlRef>
	/** Fallback name when the table has no title. */
	fallbackName?: string
}

const RESERVED = new Set(
	'all and any as asc between by case check column constraint create cross default delete desc distinct drop else end exists false foreign from full grant group having in index inner insert into is join key left like limit not null offset on or order outer primary references right select set table then to true union unique update user using values when where with'.split(
		' '
	)
)

export function stripInline(text: string): string {
	return text
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]*)\*\*/g, '$1')
		.replace(/~~([^~]*)~~/g, '$1')
		.replace(/(^|[\s(])[*_]([^*_]+)[*_](?=$|[\s),.])/g, '$1$2')
		.trim()
}

export function sqlIdent(raw: string, fallback = 'col'): string {
	let s = stripInline(raw).replace(/\s+/g, '_')
	if (!s) s = fallback
	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !RESERVED.has(s.toLowerCase())) return s
	return `"${s.replace(/"/g, '""')}"`
}

/** Plain name for matching refs (unquoted, lowercase). */
const bare = (s: string) => stripInline(s).replace(/\s+/g, '_').replace(/^"|"$/g, '').toLowerCase()

export function sqlTableName(props: TableSqlProps, fallback = 'table_name'): string {
	return sqlIdent(props.showTitle && props.title.trim() ? props.title : fallback, fallback)
}

// ---------------------------------------------------------------------------
// Layout detection

const TYPE_HEADER = /^(data\s*)?type$|^datatype$|^sql\s*type$/i
const NAME_HEADER = /^(column(\s*name)?|col|name|field|attribute|property)$/i
const CONSTRAINT_HEADER = /key|constraint|pk|fk|null|flags?|modifiers?|attributes?|options?|extra|references?/i

interface EntityLayout {
	nameCol: number
	typeCol: number
	constraintCols: number[]
	commentCols: number[]
}

export function detectEntityLayout(props: TableSqlProps): EntityLayout | null {
	if (!props.headerRow || props.cells.length < 2) return null
	const header = props.cells[0].map((h) => stripInline(h))
	const typeCol = header.findIndex((h) => TYPE_HEADER.test(h))
	if (typeCol < 0) return null
	let nameCol = header.findIndex((h, i) => i !== typeCol && NAME_HEADER.test(h))
	if (nameCol < 0) nameCol = typeCol === 0 ? 1 : 0
	if (nameCol >= header.length) return null
	const constraintCols: number[] = []
	const commentCols: number[] = []
	header.forEach((h, i) => {
		if (i === nameCol || i === typeCol) return
		if (CONSTRAINT_HEADER.test(h)) constraintCols.push(i)
		else if (h) commentCols.push(i)
	})
	return { nameCol, typeCol, constraintCols, commentCols }
}

// ---------------------------------------------------------------------------
// Constraint parsing

interface ParsedColumn {
	name: string
	type: string
	pk: boolean
	notNull: boolean
	unique: boolean
	identity: boolean
	fk: boolean
	ref: SqlRef | null
	defaultValue: string | null
	comments: string[]
}

const REF_PATTERN = /(?:references?|refs?|fk|foreign\s+key|→|->)\s*:?\s*([A-Za-z_][\w]*)\s*(?:\.|\(\s*)([A-Za-z_][\w]*)/i
const CONSTRAINT_TOKENS: [RegExp, keyof ParsedColumn][] = [
	[/\bprimary\s+key\b|\bpk\b/i, 'pk'],
	[/\bnot\s+null\b|\bnn\b|\brequired\b/i, 'notNull'],
	[/\bunique\b|\buq\b|\buk\b/i, 'unique'],
	[/\bauto[_\s-]?increment\b|\bidentity\b|\bserial\b|\bautoinc\b/i, 'identity'],
	[/\bforeign\s+key\b|\bfk\b/i, 'fk'],
]

function parseConstraints(text: string, col: ParsedColumn) {
	const t = stripInline(text)
	if (!t) return
	for (const [re, key] of CONSTRAINT_TOKENS) if (re.test(t)) (col[key] as boolean) = true
	const ref = REF_PATTERN.exec(t)
	if (ref) {
		col.fk = true
		col.ref = { table: ref[1], column: ref[2] }
	}
	const def = /\bdefault\s*[:=]?\s*('(?:[^']|'')*'|[^\s,;]+(?:\(\))?)/i.exec(t)
	if (def) col.defaultValue = def[1]
}

/** Split "int PK not null" into type "int" + constraint text. */
function splitType(typeCell: string): { type: string; rest: string } {
	const t = stripInline(typeCell)
	const m = /\s(primary\s+key|pk|fk|foreign\s+key|not\s+null|nn|unique|uq|default|references?|auto[_\s-]?increment|identity|→|->)\b/i.exec(
		` ${t}`
	)
	if (!m) return { type: t, rest: '' }
	const idx = m.index // index in " "+t, i.e. position in t of the char before the keyword
	return { type: t.slice(0, Math.max(0, idx)).trim(), rest: t.slice(Math.max(0, idx)).trim() }
}

function parseEntityRow(row: string[], layout: EntityLayout): ParsedColumn | null {
	const nameCell = stripInline(row[layout.nameCol] ?? '')
	const nameMatch = /[A-Za-z_][\w]*/.exec(nameCell)
	if (!nameMatch) return null
	const { type, rest } = splitType(row[layout.typeCol] ?? '')
	const col: ParsedColumn = {
		name: nameMatch[0],
		type: type || 'TEXT',
		pk: false,
		notNull: false,
		unique: false,
		identity: false,
		fk: false,
		ref: null,
		defaultValue: null,
		comments: [],
	}
	// Constraints can live in the type cell, dedicated columns, or next to the name ("id (PK)").
	parseConstraints(rest, col)
	parseConstraints(nameCell.slice(nameMatch.index + nameMatch[0].length), col)
	for (const i of layout.constraintCols) parseConstraints(row[i] ?? '', col)
	for (const i of layout.commentCols) {
		const c = stripInline(row[i] ?? '')
		if (c) col.comments.push(c)
	}
	return col
}

// ---------------------------------------------------------------------------
// Generation

function entityToSql(input: SqlTableInput, layout: EntityLayout): string {
	const name = sqlTableName(input.props, input.fallbackName)
	const cols: ParsedColumn[] = []
	input.props.cells.forEach((row, r) => {
		if (r === 0) return
		const col = parseEntityRow(row, layout)
		if (!col) return
		const extra = input.refs?.get(r)
		if (extra && !col.ref) {
			col.ref = extra
			col.fk = true
		}
		cols.push(col)
	})
	if (!cols.length) return `-- ${name}: no columns found\n`

	const pkCols = cols.filter((c) => c.pk)
	const composite = pkCols.length > 1
	const lines: string[] = []
	for (const c of cols) {
		for (const cm of c.comments) lines.push(`  -- ${cm.replace(/\n/g, ' ')}`)
		// Uppercase only the type keyword so enum('a','b') / varchar(255) keep their arguments intact.
		const parts = [sqlIdent(c.name), c.type.replace(/^[A-Za-z_][A-Za-z_ ]*/, (m) => m.toUpperCase())]
		if (c.identity) parts.push('GENERATED BY DEFAULT AS IDENTITY')
		if (c.pk && !composite) parts.push('PRIMARY KEY')
		else if (c.notNull) parts.push('NOT NULL')
		if (c.unique && !c.pk) parts.push('UNIQUE')
		if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`)
		if (c.ref) parts.push(`REFERENCES ${sqlIdent(c.ref.table)}(${sqlIdent(c.ref.column)})`)
		lines.push(`  ${parts.join(' ')},`)
		if (c.fk && !c.ref) lines.push(`  -- ${c.name}: foreign key target unknown`)
	}
	if (composite) lines.push(`  PRIMARY KEY (${pkCols.map((c) => sqlIdent(c.name)).join(', ')}),`)
	// Drop the trailing comma from the last definition line (skip trailing comment lines).
	for (let i = lines.length - 1; i >= 0; i--) {
		if (!lines[i].trimStart().startsWith('--')) {
			lines[i] = lines[i].replace(/,$/, '')
			break
		}
	}
	return `CREATE TABLE ${name} (\n${lines.join('\n')}\n);\n`
}

function inferType(values: string[]): string {
	const v = values.map((s) => stripInline(s)).filter((s) => s !== '')
	if (!v.length) return 'TEXT'
	if (v.every((s) => /^-?\d+$/.test(s))) return v.some((s) => Math.abs(Number(s)) > 2147483647) ? 'BIGINT' : 'INTEGER'
	if (v.every((s) => /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s))) return 'NUMERIC'
	if (v.every((s) => /^(true|false|yes|no)$/i.test(s))) return 'BOOLEAN'
	if (v.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))) return 'DATE'
	if (v.every((s) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s))) return 'TIMESTAMP'
	return 'TEXT'
}

function literal(value: string, type: string): string {
	const v = stripInline(value)
	if (v === '') return 'NULL'
	switch (type) {
		case 'INTEGER':
		case 'BIGINT':
		case 'NUMERIC':
			return v
		case 'BOOLEAN':
			return /^(true|yes)$/i.test(v) ? 'TRUE' : 'FALSE'
		default:
			return `'${v.replace(/'/g, "''")}'`
	}
}

function dataToSql(input: SqlTableInput): string {
	const { cells, headerRow } = input.props
	const name = sqlTableName(input.props, input.fallbackName)
	const cols = cells[0]?.length ?? 0
	const header = headerRow ? cells[0] : []
	const data = headerRow ? cells.slice(1) : cells
	const seen = new Set<string>()
	const names = Array.from({ length: cols }, (_, i) => {
		let n = sqlIdent(header[i] ?? '', `column_${i + 1}`)
		while (seen.has(n)) n = sqlIdent(`${bare(n)}_${i + 1}`)
		seen.add(n)
		return n
	})
	const types = names.map((_, i) => inferType(data.map((r) => r[i] ?? '')))
	let sql = `CREATE TABLE ${name} (\n${names.map((n, i) => `  ${n} ${types[i]}`).join(',\n')}\n);\n`
	const rows = data.filter((r) => r.some((c) => stripInline(c) !== ''))
	if (rows.length) {
		sql += `\nINSERT INTO ${name} (${names.join(', ')}) VALUES\n`
		sql += rows.map((r) => `  (${names.map((_, i) => literal(r[i] ?? '', types[i])).join(', ')})`).join(',\n')
		sql += ';\n'
	}
	return sql
}

export function tableToSql(input: SqlTableInput): string {
	const layout = detectEntityLayout(input.props)
	return layout ? entityToSql(input, layout) : dataToSql(input)
}

/** SQL column name for a data row of an entity-layout table (for mapping arrows to refs). */
export function entityColumnName(props: TableSqlProps, row: number): string | null {
	const layout = detectEntityLayout(props)
	if (!layout || row <= 0 || row >= props.cells.length) return null
	return parseEntityRow(props.cells[row], layout)?.name ?? null
}

/** True if a data row of an entity-layout table is marked as a primary key. */
export function entityRowIsPk(props: TableSqlProps, row: number): boolean {
	const layout = detectEntityLayout(props)
	if (!layout || row <= 0 || row >= props.cells.length) return false
	return parseEntityRow(props.cells[row], layout)?.pk ?? false
}

/**
 * Several tables → one script. Referenced tables are created before the tables that reference
 * them (cycles fall back to input order).
 */
export function tablesToSql(inputs: SqlTableInput[]): string {
	const names = inputs.map((t, i) => bare(sqlTableName(t.props, t.fallbackName ?? `table_${i + 1}`)))
	const deps = inputs.map((t) => {
		const d = new Set<number>()
		const layout = detectEntityLayout(t.props)
		const refTables: string[] = []
		t.refs?.forEach((r) => refTables.push(bare(r.table)))
		if (layout) {
			t.props.cells.forEach((row, r) => {
				if (r === 0) return
				const c = parseEntityRow(row, layout)
				if (c?.ref) refTables.push(bare(c.ref.table))
			})
		}
		for (const rt of refTables) {
			const j = names.indexOf(rt)
			if (j >= 0) d.add(j)
		}
		return d
	})
	const order: number[] = []
	const state = new Array(inputs.length).fill(0) // 0 new, 1 visiting, 2 done
	const visit = (i: number) => {
		if (state[i]) return
		state[i] = 1
		for (const j of deps[i]) if (state[j] === 0 && j !== i) visit(j)
		state[i] = 2
		order.push(i)
	}
	inputs.forEach((_, i) => visit(i))
	return order
		.map((i) => tableToSql({ ...inputs[i], fallbackName: inputs[i].fallbackName ?? `table_${i + 1}` }))
		.join('\n')
}
