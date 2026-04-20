import { react } from 'tldraw'
import { getAuthToken } from '../../auth/tokenStore'
import { PersistedAgentState, TldrawAgent } from '../TldrawAgent'
import { BaseAgentAppManager } from './BaseAgentAppManager'

export interface PersistedAppState {
	agents: Record<string, PersistedAgentState>
}

export class AgentAppPersistenceManager extends BaseAgentAppManager {
	private isLoadingState = false
	private agentsListCleanup: (() => void) | null = null
	private agentWatcherCleanupFns = new Map<string, () => void>()

	// Server-side config (set via configure())
	private pageId: string | null = null

	configure(pageId: string) {
		this.pageId = pageId
	}

	getIsLoadingState(): boolean {
		return this.isLoadingState
	}

	serializeState(): PersistedAppState {
		const agents = this.app.agents.getAgents()
		return {
			agents: agents.reduce(
				(acc, agent) => {
					acc[agent.id] = agent.serializeState()
					return acc
				},
				{} as Record<string, PersistedAgentState>
			),
		}
	}

	async loadState() {
		this.isLoadingState = true
		try {
			const appState = this.pageId ? await this.loadFromServer() : this.loadFromLocalStorage()
			if (!appState) {
				this.isLoadingState = false
				return
			}
			for (const agentId of Object.keys(appState.agents)) {
				this.app.agents.createAgent(agentId)
			}
			const agents = this.app.agents.getAgents()
			agents.forEach((agent) => {
				const agentState = appState.agents[agent.id]
				if (agentState) agent.loadState(agentState)
			})
		} catch (e) {
			console.error('Failed to load app state:', e)
		} finally {
			this.isLoadingState = false
		}
	}

	startAutoSave() {
		this.agentsListCleanup = react('agents list', () => {
			const agents = this.app.agents.getAgents()
			const currentAgentIds = new Set(agents.map((a) => a.id))

			for (const agent of agents) {
				if (!this.agentWatcherCleanupFns.has(agent.id)) {
					const cleanup = this.createAgentStateWatcher(agent)
					this.agentWatcherCleanupFns.set(agent.id, cleanup)
				}
			}

			for (const id of this.agentWatcherCleanupFns.keys()) {
				if (!currentAgentIds.has(id)) {
					this.agentWatcherCleanupFns.get(id)?.()
					this.agentWatcherCleanupFns.delete(id)
				}
			}

			if (!this.isLoadingState) this.saveState()
		})
	}

	private createAgentStateWatcher(agent: TldrawAgent): () => void {
		return react(`${agent.id} state`, () => {
			agent.chat.getHistory()
			agent.chatOrigin.getOrigin()
			agent.todos.getTodos()
			agent.context.getItems()
			agent.modelName.getModelName()
			agent.debug.getDebugFlags()
			if (!this.isLoadingState) this.saveState()
		})
	}

	private saveState() {
		const agents = this.app.agents.getAgents()
		if (agents.length === 0) return
		const appState = this.serializeState()
		if (this.pageId) {
			this.saveToServer(appState).catch((e) => console.error('Failed to save agent state:', e))
		} else {
			this.saveToLocalStorage(appState)
		}
	}

	stopAutoSave() {
		this.agentsListCleanup?.()
		this.agentsListCleanup = null
		for (const cleanup of this.agentWatcherCleanupFns.values()) cleanup()
		this.agentWatcherCleanupFns.clear()
	}

	reset() {
		this.stopAutoSave()
		this.isLoadingState = false
	}

	override dispose() {
		this.stopAutoSave()
		super.dispose()
	}

	// --- Server API ---

	private async loadFromServer(): Promise<PersistedAppState | null> {
		const token = getAuthToken()
		const r = await fetch(`/api/pages/${this.pageId}/agent-state`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		})
		if (r.status === 204 || !r.ok) return null
		return r.json() as Promise<PersistedAppState>
	}

	private async saveToServer(state: PersistedAppState): Promise<void> {
		const token = getAuthToken()
		await fetch(`/api/pages/${this.pageId}/agent-state`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify(state),
		})
	}

	// --- localStorage fallback ---

	private loadFromLocalStorage(): PersistedAppState | null {
		try {
			const stored = localStorage.getItem('tldraw-agent-app:state')
			return stored ? (JSON.parse(stored) as PersistedAppState) : null
		} catch {
			return null
		}
	}

	private saveToLocalStorage(state: PersistedAppState): void {
		try {
			localStorage.setItem('tldraw-agent-app:state', JSON.stringify(state))
		} catch {
			// ignore
		}
	}
}
