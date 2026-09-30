import { uniqueId, useValue } from '@tldraw/editor'
import { useCallback, useRef } from 'react'
import { useAgent, useAgents, useTldrawAgentApp } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatImage } from './chatAttachments'
import { ChatInput } from './ChatInput'
import { ChatSessionsMenu } from './ChatSessionsMenu'
import { runSlashCommand } from './slashCommands'
import { TodoList } from './TodoList'

export function ChatPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	const app = useTldrawAgentApp()
	const agent = useAgent()
	const agents = useAgents()
	const isDark = useValue('isDark', () => agent.editor.user.getIsDarkMode(), [agent.editor])
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleSend = useCallback(
		async (text: string, images: ChatImage[]): Promise<string | void> => {
			let agentMessage = text
			let display = text

			if (text.startsWith('/') && images.length === 0) {
				const result = await runSlashCommand(agent.editor, text)
				if (result?.kind === 'local') return result.notice
				if (result?.kind === 'agent') {
					agentMessage = result.message
					display = result.display
				}
			}

			if (images.length > 0) {
				const what = images.length === 1 ? 'an image' : `${images.length} images`
				agentMessage = `${text || 'Recreate this on the canvas.'}\n\n(The user attached ${what} to this message. If it's a sketch, whiteboard photo or screenshot of a diagram, recreate it on the canvas as clean, editable shapes: keep its structure and all its text, connect things with arrows bound to the shapes, and give it a tidy layout.)`
				display = `${text || 'Recreate this on the canvas'} 📎 ${what}`
			}

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [agentMessage],
					userMessages: [display],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
					// Images ride along as request data (sent as real images, not kept in chat history)
					data: images.map((i) => i.dataUrl),
				},
			})
		},
		[agent]
	)

	const handleNewChat = useCallback(() => {
		const newAgent = app.agents.createAgent(uniqueId())
		app.agents.setActiveAgentId(newAgent.id)
	}, [app])

	return (
		<div className={`chat-panel ${isDark ? 'tl-theme__dark' : 'tl-theme__light'}${open ? '' : ' chat-panel--collapsed'}`}>
			<button
				className="chat-panel-toggle"
				onClick={onToggle}
				title={open ? 'Collapse chat panel' : 'Open chat panel'}
			>
				{open ? '›' : '‹'}
			</button>
			<div className="chat-header">
				<ChatSessionsMenu app={app} agents={agents} activeAgent={agent} />
				<button className="new-chat-button" onClick={handleNewChat} title="New chat">
					+
				</button>
			</div>
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<TodoList agent={agent} />
				<ChatInput onSend={handleSend} onCancel={() => agent.cancel()} inputRef={inputRef} />
			</div>
		</div>
	)
}
