import { useValue } from '@tldraw/editor'
import { TldrawAgent } from '../agent/TldrawAgent'
import { TldrawAgentApp } from '../agent/TldrawAgentApp'
import { TrashIcon } from '../../shared/icons/TrashIcon'
import { ChevronDownIcon } from '../../shared/icons/ChevronDownIcon'
import { useState, useRef, useEffect } from 'react'

export function ChatSessionsMenu({
	app,
	agents,
	activeAgent,
}: {
	app: TldrawAgentApp
	agents: TldrawAgent[]
	activeAgent: TldrawAgent
}) {
	const [isOpen, setIsOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setIsOpen(false)
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	return (
		<div className="chat-sessions-menu" ref={menuRef}>
			<button className="chat-sessions-toggle" onClick={() => setIsOpen(!isOpen)}>
				<ChatSessionName agent={activeAgent} />
				<ChevronDownIcon />
			</button>
			{isOpen && (
				<div className="chat-sessions-dropdown">
					{agents.map((agent) => (
						<div
							key={agent.id}
							className={`chat-session-item ${agent.id === activeAgent.id ? 'active' : ''}`}
							onClick={() => {
								app.agents.setActiveAgentId(agent.id)
								setIsOpen(false)
							}}
						>
							<div className="chat-session-item-name">
								<ChatSessionName agent={agent} />
							</div>
							<button
								className="chat-session-delete"
								onClick={(e) => {
									e.stopPropagation()
									if (confirm('Delete this chat session?')) {
										app.agents.deleteAgent(agent.id)
									}
								}}
								title="Delete chat"
							>
								<TrashIcon />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

function ChatSessionName({ agent }: { agent: TldrawAgent }) {
	const history = useValue('history', () => agent.chat.getHistory(), [agent])
	
	const firstPrompt = history.find(item => item.type === 'prompt')
	if (firstPrompt && firstPrompt.type === 'prompt') {
		const text = firstPrompt.userFacingMessage || firstPrompt.agentFacingMessage
		return <>{text.length > 30 ? text.slice(0, 30) + '...' : text}</>
	}

	return <>Empty Chat</>
}
