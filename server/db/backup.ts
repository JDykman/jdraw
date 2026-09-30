import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { db, DB_PATH } from './db.js'

const BACKUP_DIR = process.env.BACKUP_DIR ?? join(dirname(DB_PATH), 'backups')
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP ?? 14)
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const FILE_PATTERN = /^jdraw-(\d{4}-\d{2}-\d{2})\.db$/

let running = false

function todayStamp() {
	return new Date().toISOString().slice(0, 10)
}

function listBackups(): string[] {
	if (!existsSync(BACKUP_DIR)) return []
	// ISO dates sort lexically, so newest is last
	return readdirSync(BACKUP_DIR).filter((f) => FILE_PATTERN.test(f)).sort()
}

/** Take today's backup if it doesn't exist yet, then prune to the newest BACKUP_KEEP. */
export async function runDailyBackup() {
	if (running) return
	running = true
	try {
		mkdirSync(BACKUP_DIR, { recursive: true })
		const file = `jdraw-${todayStamp()}.db`
		if (!listBackups().includes(file)) {
			const target = join(BACKUP_DIR, file)
			const tmp = `${target}.partial`
			rmSync(tmp, { force: true })
			// Online backup API: consistent copy without blocking writers for the whole run
			await db.backup(tmp)
			renameSync(tmp, target)
			console.log(`Backup written: ${target}`)
		}
		const backups = listBackups()
		for (const old of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) {
			rmSync(join(BACKUP_DIR, old), { force: true })
		}
	} catch (e) {
		console.error('Backup failed:', e)
	} finally {
		running = false
	}
}

export function startBackupSchedule() {
	if (process.env.BACKUP_DISABLED === '1') return
	runDailyBackup()
	setInterval(runDailyBackup, CHECK_INTERVAL_MS).unref()
}
