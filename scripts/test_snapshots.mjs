import { TLSocketRoom } from '@tldraw/sync'
import { createTLSchema } from '@tldraw/tlschema'
import { createRequire } from 'module'
import { existsSync } from 'fs'

const require = createRequire(existsSync('/app/package.json') ? '/app/package.json' : import.meta.url)
const Database = require('better-sqlite3')

const DB_PATH = process.argv[2] ?? './jdraw.db'
const db = new Database(DB_PATH)
const rows = db.prepare("SELECT p.name, ps.snapshot FROM pages p JOIN page_snapshots ps ON p.id = ps.page_id ORDER BY p.created_at DESC LIMIT 10").all()

for (const { name, snapshot } of rows) {
  const snap = JSON.parse(snapshot)
  try {
    new TLSocketRoom({ schema: createTLSchema(), initialSnapshot: snap })
    console.log(`✓ ${name}`)
  } catch(e) {
    console.log(`✗ ${name}: ${e.message}`)
  }
}
