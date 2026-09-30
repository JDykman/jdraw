import { useMemo, useState } from 'react'
import {
	Editor,
	TldrawUiButton,
	TldrawUiButtonLabel,
	TldrawUiDialogBody,
	TldrawUiDialogCloseButton,
	TldrawUiDialogFooter,
	TldrawUiDialogHeader,
	TldrawUiDialogTitle,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TLUiDialogProps,
	useDialogs,
	useEditor,
	useToasts,
	useValue,
} from 'tldraw'
import { useTldrawAgentAppFromEditor } from '../agent/TldrawAgentAppProvider'
import { canvasToGraph } from './canvasGraph'
import { insertGraph } from './insertGraph'
import { detectDiagramSource, DiagramSource, parseDiagramSource, SOURCE_LABELS } from './importText'
import { getLayoutTargets, layoutShapes } from './layout'
import { toMermaid } from './mermaid'

type ImportFormat = 'auto' | DiagramSource | 'typescript'

const TS_PROMPT = `Draw a diagram of the following TypeScript types. Use one table shape per interface/type/class with a title and "Field | Type" columns (mark optional fields with "?"), use enums/unions as small tables too, and connect fields that reference another type to that type with arrows between the rows. Arrange it neatly.

\`\`\`ts
`

function ImportDiagramDialog({ onClose }: TLUiDialogProps) {
	const editor = useEditor()
	const app = useTldrawAgentAppFromEditor()
	const [text, setText] = useState('')
	const [format, setFormat] = useState<ImportFormat>('auto')
	const [error, setError] = useState<string | null>(null)

	const detected = useMemo(() => (text.trim() ? detectDiagramSource(text) : null), [text])
	const effective: DiagramSource | 'typescript' | null = format === 'auto' ? detected : format

	function submit() {
		setError(null)
		if (!effective) {
			setError('Couldn’t tell what this is. Pick a format.')
			return
		}
		if (effective === 'typescript') {
			const agent = app?.agents.getAgent()
			if (!agent) {
				setError('The agent isn’t ready yet.')
				return
			}
			agent.prompt(`${TS_PROMPT}${text.trim()}\n\`\`\``)
			onClose()
			return
		}
		try {
			insertGraph(editor, parseDiagramSource(effective, text))
			onClose()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	return (
		<>
			<TldrawUiDialogHeader>
				<TldrawUiDialogTitle>Import diagram from code</TldrawUiDialogTitle>
				<TldrawUiDialogCloseButton />
			</TldrawUiDialogHeader>
			<TldrawUiDialogBody style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10 }}>
				<label className="diagram-import-row">
					<span>Format</span>
					<select value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)}>
						<option value="auto">Auto-detect{detected ? ` (${SOURCE_LABELS[detected]})` : ''}</option>
						<option value="mermaid">{SOURCE_LABELS.mermaid}</option>
						<option value="sql">{SOURCE_LABELS.sql}</option>
						<option value="compose">{SOURCE_LABELS.compose}</option>
						<option value="typescript">TypeScript types (uses the agent)</option>
					</select>
				</label>
				<textarea
					className="diagram-import-text"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder={'flowchart LR\n  A[Client] --> B[API] --> C[(DB)]\n\n…or CREATE TABLE statements, a docker-compose.yml, or TypeScript types'}
					spellCheck={false}
					autoFocus
					onKeyDown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
						e.stopPropagation()
					}}
				/>
				{error && <div className="diagram-import-error">{error}</div>}
				<div className="diagram-import-hint">Tip: pasting any of these straight onto the canvas works too.</div>
			</TldrawUiDialogBody>
			<TldrawUiDialogFooter className="tlui-dialog__footer__actions">
				<TldrawUiButton type="normal" onClick={onClose}>
					<TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel>
				</TldrawUiButton>
				<TldrawUiButton type="primary" onClick={submit} disabled={!text.trim()}>
					<TldrawUiButtonLabel>{effective === 'typescript' ? 'Ask agent' : 'Import'}</TldrawUiButtonLabel>
				</TldrawUiButton>
			</TldrawUiDialogFooter>
		</>
	)
}

export async function copyAsMermaid(editor: Editor): Promise<boolean> {
	const graph = canvasToGraph(editor)
	if (!graph) return false
	await navigator.clipboard.writeText(toMermaid(graph))
	return true
}

/** Diagram items for the canvas context menu. */
export function DiagramContextMenuItems() {
	const editor = useEditor()
	const { addDialog } = useDialogs()
	const { addToast } = useToasts()
	const layoutCount = useValue('layout targets', () => getLayoutTargets(editor).length, [editor])
	const hasSelection = useValue('has selection', () => editor.getSelectedShapeIds().length > 0, [editor])
	const scope = hasSelection ? 'selection' : 'page'

	const layout = (direction: 'TB' | 'LR') => {
		if (!layoutShapes(editor, getLayoutTargets(editor), direction)) {
			addToast({ title: 'Nothing to lay out', severity: 'info' })
		}
	}

	return (
		<TldrawUiMenuGroup id="diagram">
			{layoutCount > 1 && (
				<>
					<TldrawUiMenuItem id="diagram-layout-tb" label={`Auto-layout ${scope} ↓`} onSelect={() => layout('TB')} />
					<TldrawUiMenuItem id="diagram-layout-lr" label={`Auto-layout ${scope} →`} onSelect={() => layout('LR')} />
				</>
			)}
			<TldrawUiMenuItem
				id="diagram-copy-mermaid"
				label={`Copy ${scope} as Mermaid`}
				onSelect={async () => {
					try {
						const ok = await copyAsMermaid(editor)
						addToast(
							ok
								? { title: 'Copied as Mermaid', severity: 'success' }
								: { title: 'No boxes or text to export', severity: 'info' }
						)
					} catch {
						addToast({ title: 'Couldn’t write to the clipboard', severity: 'error' })
					}
				}}
			/>
			<TldrawUiMenuItem
				id="diagram-import"
				label="Import diagram from code…"
				onSelect={() => {
					addDialog({ component: ImportDiagramDialog })
				}}
			/>
		</TldrawUiMenuGroup>
	)
}
