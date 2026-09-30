import { atom, Atom } from 'tldraw'
import { AgentUsage, estimateCost } from '../../../shared/models'
import type { TldrawAgent } from '../TldrawAgent'
import { BaseAgentManager } from './BaseAgentManager'

export interface UsageTotals {
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	/** USD; null if any counted response came from a model without pricing */
	cost: number | null
	requests: number
}

const EMPTY: UsageTotals = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	cost: 0,
	requests: 0,
}

function add(totals: UsageTotals, usage: AgentUsage): UsageTotals {
	const cost = estimateCost(usage)
	return {
		inputTokens: totals.inputTokens + usage.inputTokens,
		outputTokens: totals.outputTokens + usage.outputTokens,
		cacheReadTokens: totals.cacheReadTokens + usage.cacheReadTokens,
		cacheWriteTokens: totals.cacheWriteTokens + usage.cacheWriteTokens,
		cost: totals.cost === null || cost === null ? null : totals.cost + cost,
		requests: totals.requests + 1,
	}
}

/**
 * Token usage and estimated cost for this chat: the latest user prompt (which may span several
 * model requests while the agent works) and the whole chat. Not persisted.
 */
export class AgentUsageManager extends BaseAgentManager {
	private $prompt: Atom<UsageTotals>
	private $chat: Atom<UsageTotals>

	constructor(agent: TldrawAgent) {
		super(agent)
		this.$prompt = atom('promptUsage', EMPTY)
		this.$chat = atom('chatUsage', EMPTY)
	}

	/** Start counting a new user prompt. */
	startPrompt() {
		this.$prompt.set(EMPTY)
	}

	record(usage: AgentUsage) {
		this.$prompt.update((t) => add(t, usage))
		this.$chat.update((t) => add(t, usage))
	}

	getPromptUsage() {
		return this.$prompt.get()
	}

	getChatUsage() {
		return this.$chat.get()
	}

	reset() {
		this.$prompt.set(EMPTY)
		this.$chat.set(EMPTY)
	}
}
