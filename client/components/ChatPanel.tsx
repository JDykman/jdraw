import { uniqueId, useValue } from '@tldraw/editor'
import { FormEventHandler, useCallback, useRef } from 'react'
import { useAgent, useAgents, useTldrawAgentApp } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { ChatSessionsMenu } from './ChatSessionsMenu'
import { TodoList } from './TodoList'

export function ChatPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	const app = useTldrawAgentApp()
	const agent = useAgent()
	const agents = useAgents()
	const isDark = useValue('isDark', () => agent.editor.user.getIsDarkMode(), [agent.editor])
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string

			// If the user's message is empty, just cancel the current request (if there is one)
			if (value === '') {
				agent.cancel()
				return
			}

			// Clear the chat input (context is cleared after it's captured in requestAgentActions)
			inputRef.current.value = ''

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
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
				<ChatInput handleSubmit={handleSubmit} inputRef={inputRef} />
			</div>
		</div>
	)
}
