import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'

import { existsSync } from 'fs'
const requireBase = existsSync('/app/package.json') ? '/app/package.json' : import.meta.url
const require = createRequire(requireBase)
const Database = require('better-sqlite3')

const EXPORT_FILE = process.argv[2] ?? `${process.env.HOME}/Downloads/tldraw-export.json`
const DB_PATH = process.argv[3] ?? './jdraw.db'
const USERNAME = process.argv[4] ?? 'Jacob'

const exported = JSON.parse(readFileSync(EXPORT_FILE, 'utf8'))
const db = new Database(DB_PATH)

const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(USERNAME)
if (!user) {
  console.error(`User "${USERNAME}" not found. Pass username as 3rd argument.`)
  console.error('Users:', db.prepare('SELECT username FROM users').all().map(u => u.username).join(', '))
  process.exit(1)
}

const allRecords = exported.records ?? []
const pages = allRecords.filter(r => r.typeName === 'page')
const schema = exported.schema?.[0] ?? null

console.log(`Found ${pages.length} pages, importing for user "${USERNAME}" (${user.id})`)

const insertPage = db.prepare(
  'INSERT OR IGNORE INTO pages (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
)
const insertSnapshot = db.prepare(
  'INSERT OR REPLACE INTO page_snapshots (page_id, snapshot, updated_at) VALUES (?, ?, ?)'
)

for (const page of pages) {
  const oldPageId = page.id
  const newPageId = randomUUID()
  const now = Date.now()

  // Collect all records belonging to this page (exclude client-only types)
  const clientOnlyTypes = new Set(['instance', 'instance_page_state', 'camera', 'instance_presence'])
  const pageRecords = allRecords.filter(r => {
    if (clientOnlyTypes.has(r.typeName)) return false
    if (r.typeName === 'document') return true
    if (r.typeName === 'page') return r.id === oldPageId
    if (r.typeName === 'asset') return true
    // shapes and bindings reference their page via parentId or pageId
    if (r.parentId === oldPageId) return true
    if (r.pageId === oldPageId) return true
    return false
  })

  // Also grab shapes nested under other shapes on this page
  const pageShapeIds = new Set(
    pageRecords.filter(r => r.typeName === 'shape').map(r => r.id)
  )
  let added = true
  while (added) {
    added = false
    for (const r of allRecords) {
      if (r.typeName === 'shape' && pageShapeIds.has(r.parentId) && !pageShapeIds.has(r.id)) {
        pageRecords.push(r)
        pageShapeIds.add(r.id)
        added = true
      }
    }
  }

  // Include bindings whose endpoints are both shapes on this page
  for (const r of allRecords) {
    if (r.typeName === 'binding' && pageShapeIds.has(r.fromId) && pageShapeIds.has(r.toId)) {
      pageRecords.push(r)
    }
  }

  // Remap old page id to new page id in all records
  const EMPTY_RICH_TEXT = { type: 'doc', content: [{ type: 'paragraph' }] }
  const richTextShapeTypes = new Set(['arrow', 'text', 'geo', 'note'])
  const remapped = pageRecords.map(r => {
    const json = JSON.stringify(r)
      .replaceAll(oldPageId, `page:${newPageId}`)
    const record = JSON.parse(json)
    if (record.typeName === 'page') record.id = `page:${newPageId}`
    // At schema v8, arrow/text/geo/note shapes must have richText and must NOT have text.
    if (record.typeName === 'shape' && richTextShapeTypes.has(record.type) && record.props) {
      if (!record.props.richText) record.props.richText = EMPTY_RICH_TEXT
      delete record.props.text
    }
    return record
  })

  const snapshot = {
    tombstoneHistoryStartsAtClock: 0,
    documentClock: remapped.length,
    documents: remapped.map((state, i) => ({ state, lastChangedClock: i })),
    tombstones: {},
    ...(schema ? { schema } : {}),
  }

  insertPage.run(newPageId, user.id, page.name, now, now)
  insertSnapshot.run(newPageId, JSON.stringify(snapshot), now)
  console.log(`  ✓ "${page.name}" → ${newPageId}`)
}

console.log('Done.')
