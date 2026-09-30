import { useValue } from 'tldraw'
import type { TldrawAgent } from '../agent/TldrawAgent'
import type { UsageTotals } from '../agent/managers/AgentUsageManager'

function formatTokens(n: number) {
	if (n < 1000) return String(n)
	if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
	return `${Math.round(n / 1000)}k`
}

function formatCost(cost: number | null) {
	if (cost === null) return null
	if (cost === 0) return '$0'
	if (cost < 0.01) return '<$0.01'
	return `$${cost.toFixed(cost < 1 ? 3 : 2)}`
}

function describe(label: string, t: UsageTotals) {
	const input = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens
	const cached = t.cacheReadTokens ? ` (${formatTokens(t.cacheReadTokens)} cached)` : ''
	const cost = formatCost(t.cost)
	return `${label}: ${formatTokens(input)} in${cached} · ${formatTokens(t.outputTokens)} out · ${t.requests} request${t.requests === 1 ? '' : 's'}${cost ? ` · ≈${cost}` : ' · no price for this model'}`
}

/** Compact token/cost readout for the latest prompt, with the chat total on hover. */
export function UsageMeter({ agent }: { agent: TldrawAgent }) {
	const prompt = useValue('prompt usage', () => agent.usage.getPromptUsage(), [agent])
	const chat = useValue('chat usage', () => agent.usage.getChatUsage(), [agent])
	if (chat.requests === 0) return null

	const shown = prompt.requests > 0 ? prompt : chat
	const cost = formatCost(shown.cost)
	const title = `${describe('Last prompt', prompt)}\n${describe('This chat', chat)}\nEstimated from list prices; excludes other providers' pricing.`

	return (
		<span className="chat-usage" title={title}>
			{cost ?? `${formatTokens(shown.inputTokens + shown.cacheReadTokens + shown.cacheWriteTokens + shown.outputTokens)} tok`}
			{chat.requests > prompt.requests && chat.cost !== null && <span className="chat-usage-total"> · chat {formatCost(chat.cost)}</span>}
		</span>
	)
}
