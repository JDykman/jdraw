import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Editor, RecordsDiff, TLRecord, TLShape, TLShapeId } from 'tldraw'
import { TldrawDiffViewer } from '../components/chat-history/TldrawDiffViewer'
import { useApi } from '../pages/pagesApi'
import { Checkpoint } from './HistoryPanel'
import { countDiff, diffShapes, formatCounts, roomSnapshotToStoreSnapshot, shapesOnPage } from './snapshotDiff'

type Direction = 'checkpoint-to-now' | 'now-to-checkpoint'

function timeLabel(ts: number) {
	return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Modal comparing the current tldraw page against a checkpoint. The checkpoint is migrated to
 * the editor's schema first; only shapes on the current page take part in the diff.
 */
export function CompareDialog({
	pageId,
	checkpoint,
	editor,
	onClose,
}: {
	pageId: string
	checkpoint: Checkpoint
	editor: Editor
	onClose(): void
}) {
	const api = useApi()
	const [checkpointShapes, setCheckpointShapes] = useState<Map<TLShapeId, TLShape> | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [direction, setDirection] = useState<Direction>('checkpoint-to-now')

	// Snapshot the current page once when the dialog opens, so the diff doesn't shift under the user
	const currentShapes = useMemo(
		() => shapesOnPage(editor.store.allRecords(), editor.getCurrentPageId()),
		[editor]
	)

	useEffect(() => {
		let cancelled = false
		;(async () => {
			try {
				const data = await api<{ snapshot: string }>(`/pages/${pageId}/checkpoints/${checkpoint.id}`)
				const storeSnapshot = roomSnapshotToStoreSnapshot(JSON.parse(data.snapshot))
				const migrated = editor.store.schema.migrateStoreSnapshot(storeSnapshot)
				if (migrated.type !== 'success') {
					throw new Error(`This version can't be migrated to the current format (${migrated.reason}).`)
				}
				if (!cancelled) {
					setCheckpointShapes(shapesOnPage(Object.values(migrated.value) as TLRecord[], editor.getCurrentPageId()))
				}
			} catch (e) {
				if (!cancelled) setError((e as Error).message)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [api, pageId, checkpoint.id, editor])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	const diff: RecordsDiff<TLRecord> | null = useMemo(() => {
		if (!checkpointShapes) return null
		return direction === 'checkpoint-to-now'
			? diffShapes(checkpointShapes, currentShapes)
			: diffShapes(currentShapes, checkpointShapes)
	}, [checkpointShapes, currentShapes, direction])

	const title = checkpoint.label ? `“${checkpoint.label}”` : `version from ${timeLabel(checkpoint.createdAt)}`

	return createPortal(
		<div className="compare-overlay" onMouseDown={onClose}>
			<div
				className="compare-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Compare versions"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="compare-header">
					<div>
						<h3>Compare with {title}</h3>
						<div className="compare-counts">{diff ? formatCounts(countDiff(diff)) : error ? '' : 'Loading…'}</div>
					</div>
					<div className="compare-controls">
						<div className="compare-direction" role="group" aria-label="Direction">
							<button
								aria-pressed={direction === 'checkpoint-to-now'}
								onClick={() => setDirection('checkpoint-to-now')}
								title="Green: added since the version. Red: removed since the version."
							>
								Version → now
							</button>
							<button
								aria-pressed={direction === 'now-to-checkpoint'}
								onClick={() => setDirection('now-to-checkpoint')}
								title="What restoring this version would change"
							>
								Now → version
							</button>
						</div>
						<button className="history-icon-btn" onClick={onClose} aria-label="Close compare">
							✕
						</button>
					</div>
				</div>
				<div className="compare-body">
					{error && (
						<div className="history-error" role="alert">
							{error}
						</div>
					)}
					{diff && <TldrawDiffViewer diff={diff} />}
				</div>
				<div className="compare-legend">
					<span className="compare-legend-item compare-legend-item--added">added</span>
					<span className="compare-legend-item compare-legend-item--updated">changed (dashed = before)</span>
					<span className="compare-legend-item compare-legend-item--removed">removed</span>
				</div>
			</div>
		</div>,
		document.body
	)
}
