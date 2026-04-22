import { Editor, EditorAtom, uniqueId } from 'tldraw'
import { TldrawAgent } from '../TldrawAgent'
import type { TldrawAgentApp } from '../TldrawAgentApp'
import { BaseAgentAppManager } from './BaseAgentAppManager'

/**
 * Generate a unique agent ID.
 */
function generateAgentId(): string {
	return uniqueId()
}

/**
 * Manager for agent lifecycle - creation, disposal, and tracking.
 *
 * Manages multiple agents per editor. The agents are stored in an EditorAtom
 * so they can be accessed from tools that only have access to the editor.
 *
 * Use the static methods `getAgents(editor)` and `getAgent(editor, id)` to access
 * agents from tools. Use instance methods for agent lifecycle management.
 */
export class AgentAppAgentsManager extends BaseAgentAppManager {
	/**
	 * Static EditorAtom containing the app instance.
	 */
	private static $app = new EditorAtom<TldrawAgentApp | null>('app', () => null)

	/**
	 * Get the app instance for an editor.
	 */
	static getApp(editor: Editor): TldrawAgentApp | null {
		return AgentAppAgentsManager.$app.get(editor)
	}

	/**
	 * Set the app instance for an editor.
	 */
	static setApp(editor: Editor, app: TldrawAgentApp | null): void {
		AgentAppAgentsManager.$app.set(editor, app)
	}

	/**
	 * Static EditorAtom containing agents.
	 * This allows tools to access agents without needing the full TldrawAgentApp.
	 */
	private static $agents = new EditorAtom<TldrawAgent[]>('agents', () => [])

	/**
	 * Static EditorAtom containing the active agent ID.
	 */
	private static $activeAgentId = new EditorAtom<string | null>('activeAgentId', () => null)

	/**
	 * Get all agents for an editor.
	 * Use this static method from tools that only have access to the editor.
	 */
	static getAgents(editor: Editor): TldrawAgent[] {
		return AgentAppAgentsManager.$agents.get(editor)
	}

	/**
	 * Get the active agent ID for an editor.
	 */
	static getActiveAgentId(editor: Editor): string | null {
		return AgentAppAgentsManager.$activeAgentId.get(editor)
	}

	/**
	 * Set the active agent ID for an editor.
	 */
	static setActiveAgentId(editor: Editor, id: string | null): void {
		AgentAppAgentsManager.$activeAgentId.set(editor, id)
	}

	/**
	 * Get an agent by ID for an editor.
	 * If no ID is provided, returns the active agent, or the first agent.
	 * Use this static method from tools that only have access to the editor.
	 */
	static getAgent(editor: Editor, id?: string): TldrawAgent | undefined {
		const agents = AgentAppAgentsManager.$agents.get(editor)
		if (id) {
			return agents.find((agent) => agent.id === id)
		}
		const activeId = AgentAppAgentsManager.$activeAgentId.get(editor)
		if (activeId) {
			const activeAgent = agents.find((agent) => agent.id === activeId)
			if (activeAgent) return activeAgent
		}
		return agents[0]
	}

	/**
	 * Get all agents.
	 */
	getAgents(): TldrawAgent[] {
		return AgentAppAgentsManager.$agents.get(this.app.editor)
	}

	/**
	 * Get the active agent ID.
	 */
	getActiveAgentId(): string | null {
		return AgentAppAgentsManager.$activeAgentId.get(this.app.editor)
	}

	/**
	 * Set the active agent ID.
	 */
	setActiveAgentId(id: string | null): void {
		AgentAppAgentsManager.$activeAgentId.set(this.app.editor, id)
	}

	/**
	 * Get an agent by ID.
	 * If no ID is provided, returns the active agent, or the first agent.
	 */
	getAgent(id?: string): TldrawAgent | undefined {
		const agents = AgentAppAgentsManager.$agents.get(this.app.editor)
		if (id) {
			return agents.find((agent) => agent.id === id)
		}
		const activeId = AgentAppAgentsManager.$activeAgentId.get(this.app.editor)
		if (activeId) {
			const activeAgent = agents.find((agent) => agent.id === activeId)
			if (activeAgent) return activeAgent
		}
		return agents[0]
	}

	/**
	 * Create an agent with the given ID.
	 * If an agent with the ID already exists, returns the existing agent.
	 *
	 * @param id - The ID for the new agent
	 * @returns The created or existing agent
	 */
	createAgent(id: string): TldrawAgent {
		const existingAgent = this.getAgent(id)
		if (existingAgent) {
			return existingAgent
		}

		const agent = new TldrawAgent({
			editor: this.app.editor,
			id,
			onError: this.app.options.onError,
		})

		// Register the agent in the static atom
		AgentAppAgentsManager.$agents.update(this.app.editor, (agents) => [...agents, agent])

		return agent
	}

	/**
	 * Ensure at least one agent exists.
	 * Returns the first existing agent, or creates a new one with a generated ID.
	 * Call this after the app is initialized.
	 */
	ensureAtLeastOneAgent(): TldrawAgent {
		const existingAgent = this.getAgent()
		if (existingAgent) {
			// If we have an agent but no active agent ID, set it
			if (!this.getActiveAgentId()) {
				this.setActiveAgentId(existingAgent.id)
			}
			return existingAgent
		}
		const newAgent = this.createAgent(generateAgentId())
		this.setActiveAgentId(newAgent.id)
		return newAgent
	}

	/**
	 * Delete an agent by ID.
	 * Disposes the agent and removes it from the registry.
	 *
	 * @param id - The ID of the agent to delete
	 * @returns true if the agent was found and deleted, false otherwise
	 */
	deleteAgent(id: string): boolean {
		const agent = this.getAgent(id)
		if (!agent) {
			return false
		}

		// Dispose the agent first
		agent.dispose()

		// Remove from the static atom
		AgentAppAgentsManager.$agents.update(this.app.editor, (agents) =>
			agents.filter((a) => a.id !== id)
		)

		// If the active agent was deleted, switch to another one
		if (this.getActiveAgentId() === id) {
			const remainingAgents = this.getAgents()
			this.setActiveAgentId(remainingAgents.length > 0 ? remainingAgents[0].id : null)
		}

		return true
	}

	/**
	 * Reset the state of all agents without disposing them.
	 * Clears chats, todos, context, and returns agents to initial mode.
	 */
	resetAllAgents() {
		const agents = AgentAppAgentsManager.$agents.get(this.app.editor)
		agents.forEach((agent) => agent.reset())
	}

	/**
	 * Dispose all agents. Call this during cleanup.
	 */
	disposeAllAgents() {
		const agents = AgentAppAgentsManager.$agents.get(this.app.editor)
		agents.forEach((agent) => agent.dispose())
		AgentAppAgentsManager.$agents.set(this.app.editor, [])
	}

	/**
	 * Reset the manager to its initial state.
	 */
	reset() {
		this.resetAllAgents()
	}

	/**
	 * Dispose of the manager and all agents.
	 */
	override dispose() {
		this.disposeAllAgents()
		super.dispose()
	}
}
