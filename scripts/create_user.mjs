import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const { USERNAME, PASSWORD, IS_ADMIN, DB_PATH = '/data/jdraw.db' } = process.env

if (!USERNAME || !PASSWORD) {
  console.error('USERNAME and PASSWORD env vars required')
  process.exit(1)
}

const db = new Database(DB_PATH)
const hash = await bcrypt.hash(PASSWORD, 12)
try {
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), USERNAME, hash, IS_ADMIN === '1' ? 1 : 0, Date.now()
  )
  console.log('User created successfully.')
} catch (e) {
  if (e.message?.includes('UNIQUE')) {
    console.error('Error: Username already exists.')
    process.exit(1)
  }
  throw e
}
