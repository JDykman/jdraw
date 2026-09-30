import { useEffect, useRef, useState } from 'react'
import { Editor, useValue } from 'tldraw'
import { AtIcon } from '../../shared/icons/AtIcon'
import { BrainIcon } from '../../shared/icons/BrainIcon'
import { ChevronDownIcon } from '../../shared/icons/ChevronDownIcon'
import { AGENT_MODEL_DEFINITIONS, AgentModelName } from '../../shared/models'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatImage, fileToChatImage, imageFilesFrom, MAX_CHAT_IMAGES } from './chatAttachments'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'
import { matchSlashCommands } from './slashCommands'
import { UsageMeter } from './UsageMeter'

export function ChatInput({
	onSend,
	onCancel,
	inputRef,
}: {
	/** Returns a short notice to show under the input (e.g. from a local slash command) */
	onSend(text: string, images: ChatImage[]): Promise<string | void>
	onCancel(): void
	inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
	const agent = useAgent()
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const [images, setImages] = useState<ChatImage[]>([])
	const [notice, setNotice] = useState<string | null>(null)
	const [commandIndex, setCommandIndex] = useState(0)
	const [commandsDismissed, setCommandsDismissed] = useState(false)
	const [dragging, setDragging] = useState(false)
	const fileRef = useRef<HTMLInputElement>(null)
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])

	const isContextToolActive = useValue(
		'isContextToolActive',
		() => {
			const tool = editor.getCurrentTool()
			return tool.id === 'target-shape' || tool.id === 'target-area'
		},
		[editor]
	)

	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])

	const commands = commandsDismissed ? [] : matchSlashCommands(inputValue)
	const activeCommand = commands[Math.min(commandIndex, commands.length - 1)]

	useEffect(() => setCommandIndex(0), [inputValue])
	useEffect(() => {
		if (!notice) return
		const t = setTimeout(() => setNotice(null), 4000)
		return () => clearTimeout(t)
	}, [notice])

	async function addFiles(files: File[]) {
		const room = MAX_CHAT_IMAGES - images.length
		if (files.length > room) setNotice(`Up to ${MAX_CHAT_IMAGES} images per message`)
		const added = await Promise.all(files.slice(0, Math.max(0, room)).map(fileToChatImage))
		setImages((current) => [...current, ...added].slice(0, MAX_CHAT_IMAGES))
	}

	function completeCommand() {
		if (!activeCommand) return
		setInputValue(`/${activeCommand.name} `)
		setCommandsDismissed(false)
		inputRef.current?.focus()
	}

	async function submit() {
		const text = inputValue.trim()
		if (!text && images.length === 0) {
			if (isGenerating) onCancel()
			return
		}
		const sent = images
		setInputValue('')
		setImages([])
		setCommandsDismissed(false)
		const result = await onSend(text, sent)
		if (result) setNotice(result)
	}

	return (
		<div className="chat-input">
			<form
				className={dragging ? 'chat-input--dragging' : undefined}
				onSubmit={(e) => {
					e.preventDefault()
					submit()
				}}
				onDragOver={(e) => {
					if (e.dataTransfer.types.includes('Files')) {
						e.preventDefault()
						setDragging(true)
					}
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					const files = imageFilesFrom(e.dataTransfer.files)
					setDragging(false)
					if (files.length === 0) return
					e.preventDefault()
					addFiles(files)
				}}
			>
				<div className="prompt-tags">
					<div className={'chat-context-select ' + (isContextToolActive ? 'active' : '')}>
						<div className="chat-context-select-label">
							<AtIcon /> Add Context
						</div>
						<select
							id="chat-context-select"
							value=" "
							onChange={(e) => {
								const action = ADD_CONTEXT_ACTIONS.find((action) => action.name === e.target.value)
								if (action) action.onSelect(editor)
							}}
						>
							{ADD_CONTEXT_ACTIONS.map((action) => {
								return (
									<option key={action.name} value={action.name}>
										{action.name}
									</option>
								)
							})}
						</select>
					</div>
					{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
					{contextItems.map((item, i) => (
						<ContextItemTag
							editor={editor}
							onClick={() => agent.context.remove(item)}
							key={'context-item-' + i}
							item={item}
						/>
					))}
				</div>

				{images.length > 0 && (
					<div className="chat-attachments">
						{images.map((img) => (
							<div key={img.id} className="chat-attachment" title={img.name}>
								<img src={img.dataUrl} alt={img.name} />
								<button
									type="button"
									aria-label={`Remove ${img.name}`}
									onClick={() => setImages((list) => list.filter((i) => i.id !== img.id))}
								>
									✕
								</button>
							</div>
						))}
					</div>
				)}

				{commands.length > 0 && (
					<ul className="slash-commands" role="listbox" aria-label="Commands">
						{commands.map((c) => (
							<li
								key={c.name}
								role="option"
								aria-selected={c === activeCommand}
								onMouseDown={(e) => {
									e.preventDefault()
									setInputValue(`/${c.name} `)
									inputRef.current?.focus()
								}}
							>
								<span className="slash-command-name">/{c.name}</span>
								{c.args && <span className="slash-command-args">{c.args}</span>}
								<span className="slash-command-desc">
									{c.description}
									{c.local && <span className="slash-command-local"> · no AI</span>}
								</span>
							</li>
						))}
					</ul>
				)}

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					placeholder={images.length ? 'Describe what to do with the image (optional)' : 'Ask, draw, or type / for commands'}
					value={inputValue}
					onInput={(e) => setInputValue(e.currentTarget.value)}
					onPaste={(e) => {
						const files = imageFilesFrom(e.clipboardData.files)
						if (files.length === 0) return
						e.preventDefault()
						addFiles(files)
					}}
					onKeyDown={(e) => {
						if (commands.length > 0) {
							if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
								e.preventDefault()
								const delta = e.key === 'ArrowDown' ? 1 : -1
								setCommandIndex((i) => (i + delta + commands.length) % commands.length)
								return
							}
							if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
								e.preventDefault()
								// Commands without arguments can run straight away
								if (e.key === 'Enter' && activeCommand && !activeCommand.args) {
									setInputValue(`/${activeCommand.name}`)
									setTimeout(() => inputRef.current?.form?.requestSubmit(), 0)
								} else completeCommand()
								return
							}
							if (e.key === 'Escape') {
								e.preventDefault()
								setCommandsDismissed(true)
								return
							}
						}
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							submit()
						}
					}}
				/>
				{notice && <div className="chat-notice">{notice}</div>}
				<span className="chat-actions">
					<div className="chat-actions-left">
						<div className="chat-model-select">
							<div className="chat-model-select-label">
								<BrainIcon /> {modelName}
							</div>
							<select
								value={modelName}
								onChange={(e) => agent.modelName.setModelName(e.target.value as AgentModelName)}
							>
								{Object.values(AGENT_MODEL_DEFINITIONS).map((model) => (
									<option key={model.name} value={model.name}>
										{model.name}
									</option>
								))}
							</select>
							<ChevronDownIcon />
						</div>
						<UsageMeter agent={agent} />
					</div>
					<div className="chat-actions-right">
						<button
							type="button"
							className="chat-attach-button"
							title="Attach images (or paste / drop them)"
							aria-label="Attach images"
							disabled={images.length >= MAX_CHAT_IMAGES}
							onClick={() => fileRef.current?.click()}
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" />
							</svg>
						</button>
						<input
							ref={fileRef}
							type="file"
							accept="image/*"
							multiple
							hidden
							onChange={(e) => {
								addFiles(imageFilesFrom(e.target.files))
								e.target.value = ''
							}}
						/>
						<button
							className="chat-input-submit"
							disabled={inputValue === '' && images.length === 0 && !isGenerating}
						>
							{isGenerating && inputValue === '' && images.length === 0 ? '◼' : '⬆'}
						</button>
					</div>
				</span>
			</form>
		</div>
	)
}

const ADD_CONTEXT_ACTIONS = [
	{
		name: 'Pick Shapes',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-shape')
			editor.focus()
		},
	},
	{
		name: 'Pick Area',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-area')
			editor.focus()
		},
	},
	{
		name: ' ',
		onSelect: (editor: Editor) => {
			const currentTool = editor.getCurrentTool()
			if (currentTool.id === 'target-area' || currentTool.id === 'target-shape') {
				editor.setCurrentTool('select')
			}
		},
	},
]
