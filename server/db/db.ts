import BetterSqlite3 from 'better-sqlite3'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'jdraw.db')

export const db = new BetterSqlite3(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
db.exec(schema)

/** Add a column if it's missing. schema.sql only creates tables, so column additions go here. */
function ensureColumn(table: string, column: string, definition: string) {
	const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
	if (!columns.some((c) => c.name === column)) {
		db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
	}
}

// Who last changed the page's canvas content, and when (renames don't count)
ensureColumn('pages', 'last_edited_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL')
ensureColumn('pages', 'last_edited_at', 'INTEGER')
