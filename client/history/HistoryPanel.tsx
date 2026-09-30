import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useApi } from '../pages/pagesApi'
import './history.css'

export type CheckpointKind = 'auto' | 'manual' | 'pre-restore' | 'quarantine'

export interface Checkpoint {
	id: string
	pageId: string
	kind: CheckpointKind
	label: string | null
	docClock: number | null
	createdBy: string | null
	createdByName: string | null
	createdAt: number
}

interface HistoryResponse {
	checkpoints: Checkpoint[]
	canEdit: boolean
	isOwner: boolean
	loadFailed: boolean
}

const KIND_LABELS: Record<CheckpointKind, string> = {
	auto: 'Auto',
	manual: 'Saved',
	'pre-restore': 'Before restore',
	quarantine: 'Quarantined',
}

function dayKey(ts: number) {
	const d = new Date(ts)
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(ts: number, now = new Date()) {
	const d = new Date(ts)
	const today = dayKey(now.getTime())
	const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime())
	const key = dayKey(ts)
	if (key === today) return 'Today'
	if (key === yesterday) return 'Yesterday'
	return d.toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
	})
}

function timeLabel(ts: number) {
	return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Group newest-first checkpoints by calendar day, preserving order. */
export function groupByDay(checkpoints: Checkpoint[]): { key: string; label: string; items: Checkpoint[] }[] {
	const groups: { key: string; label: string; items: Checkpoint[] }[] = []
	for (const c of checkpoints) {
		const key = dayKey(c.createdAt)
		const last = groups[groups.length - 1]
		if (last && last.key === key) last.items.push(c)
		else groups.push({ key, label: dayLabel(c.createdAt), items: [c] })
	}
	return groups
}

/**
 * Side panel listing a page's checkpoints with save / restore / compare / delete actions.
 * Works with or without an editor: on the canvas and on the "couldn't load" screen.
 */
export function HistoryPanel({
	pageId,
	onClose,
	onCompare,
	onRestored,
}: {
	pageId: string
	onClose(): void
	/** Present when a live editor is available to diff against (JD-22). */
	onCompare?(checkpoint: Checkpoint): void
	onRestored?(checkpoint: Checkpoint): void
}) {
	const api = useApi()
	const [data, setData] = useState<HistoryResponse | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [label, setLabel] = useState('')

	const reload = useCallback(async () => {
		try {
			setData(await api<HistoryResponse>(`/pages/${pageId}/checkpoints`))
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [api, pageId])

	useEffect(() => {
		reload()
	}, [reload])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	const run = async (key: string, action: () => Promise<void>) => {
		setBusy(key)
		try {
			await action()
			setError(null)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(null)
		}
	}

	const save = (e: FormEvent) => {
		e.preventDefault()
		run('save', async () => {
			await api(`/pages/${pageId}/checkpoints`, { method: 'POST', json: { label: label.trim() || undefined } })
			setLabel('')
			await reload()
		})
	}

	const restore = (c: Checkpoint) => {
		const what = c.label ? `“${c.label}”` : `the version from ${timeLabel(c.createdAt)}`
		if (!confirm(`Restore ${what}?\n\nThe current state is saved as a “Before restore” version first, so this can be undone.`)) return
		run(c.id, async () => {
			await api(`/pages/${pageId}/checkpoints/${c.id}/restore`, { method: 'POST' })
			await reload()
			onRestored?.(c)
		})
	}

	const remove = (c: Checkpoint) => {
		if (!confirm('Delete this version? This cannot be undone.')) return
		run(c.id, async () => {
			await api(`/pages/${pageId}/checkpoints/${c.id}`, { method: 'DELETE' })
			await reload()
		})
	}

	const canEdit = data?.canEdit ?? false
	const groups = data ? groupByDay(data.checkpoints) : []

	return (
		<aside className="history-panel" aria-label="Page history">
			<div className="history-header">
				<h3>History</h3>
				<button className="history-icon-btn" onClick={onClose} aria-label="Close history">
					✕
				</button>
			</div>

			{canEdit && !data?.loadFailed && (
				<form className="history-save" onSubmit={save}>
					<input
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="Label (optional)"
						maxLength={120}
						aria-label="Version label"
						disabled={busy === 'save'}
					/>
					<button type="submit" className="history-btn history-btn--primary" disabled={busy === 'save'}>
						Save version
					</button>
				</form>
			)}
			{data?.loadFailed && (
				<p className="history-note">
					This page’s stored version couldn’t be loaded and was set aside as “Quarantined”. Restore an
					earlier version to get the page working again.
				</p>
			)}

			{error && (
				<div className="history-error" role="alert">
					{error}
				</div>
			)}

			<div className="history-list">
				{data === null && !error && <div className="history-empty">Loading…</div>}
				{data && data.checkpoints.length === 0 && (
					<div className="history-empty">
						No versions yet. Versions are saved automatically every 5 minutes while the page changes.
					</div>
				)}
				{groups.map((group) => (
					<section key={group.key} className="history-day">
						<h4>{group.label}</h4>
						{group.items.map((c) => {
							const restorable = c.kind !== 'quarantine'
							const deletable = data!.isOwner && (c.kind === 'manual' || c.kind === 'quarantine')
							return (
								<div key={c.id} className={`history-row history-row--${c.kind}`}>
									<div className="history-row-main">
										<span className="history-time">{timeLabel(c.createdAt)}</span>
										<span className={`history-kind history-kind--${c.kind}`}>{KIND_LABELS[c.kind]}</span>
										{c.label && <span className="history-label">{c.label}</span>}
									</div>
									<div className="history-row-meta">
										{c.createdByName ? `by ${c.createdByName}` : c.kind === 'auto' ? 'automatic' : ''}
									</div>
									<div className="history-row-actions">
										{onCompare && restorable && (
											<button className="history-btn" onClick={() => onCompare(c)} disabled={busy !== null}>
												Compare
											</button>
										)}
										{restorable && (
											<button
												className="history-btn history-btn--primary"
												onClick={() => restore(c)}
												disabled={!canEdit || busy !== null}
												title={canEdit ? undefined : 'You have read-only access to this page'}
											>
												{busy === c.id ? 'Restoring…' : 'Restore'}
											</button>
										)}
										{deletable && (
											<button
												className="history-btn history-btn--danger"
												onClick={() => remove(c)}
												disabled={busy !== null}
												aria-label="Delete version"
											>
												Delete
											</button>
										)}
									</div>
								</div>
							)
						})}
					</section>
				))}
			</div>
		</aside>
	)
}
