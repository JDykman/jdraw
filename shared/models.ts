export type AgentModelName = keyof typeof AGENT_MODEL_DEFINITIONS
export type AgentModelProvider = 'openai' | 'anthropic' | 'google'

export interface AgentModelDefinition {
	name: AgentModelName
	id: string
	provider: AgentModelProvider

	// Overrides the default thinking behavior for that provider
	thinking?: boolean

	// Anthropic models from the 4.6+ generation reject assistant prefill, `temperature`,
	// and `thinking: disabled`. They always think adaptively; we steer with effort instead.
	modernAnthropic?: boolean

	// USD per million tokens, for the chat cost meter. Omitted where we don't track prices.
	pricing?: ModelPricing
}

export interface ModelPricing {
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}

export const AGENT_MODEL_DEFINITIONS = {
	// Anthropic models
	// sonnet 5.5 is recommended: fast and strong at structured output
	'claude-sonnet-5-5': {
		name: 'claude-sonnet-5-5',
		id: 'claude-sonnet-5-5',
		provider: 'anthropic',
		pricing: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
		modernAnthropic: true,
	},

	'claude-opus-5-5': {
		name: 'claude-opus-5-5',
		id: 'claude-opus-5-5',
		provider: 'anthropic',
		pricing: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
		modernAnthropic: true,
	},

	'claude-fable-5-1': {
		name: 'claude-fable-5-1',
		id: 'claude-fable-5-1',
		provider: 'anthropic',
		pricing: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
		modernAnthropic: true,
	},

	// haiku 4.5 is the cheapest/fastest Claude option and still supports prefill
	'claude-haiku-4-5': {
		name: 'claude-haiku-4-5',
		id: 'claude-haiku-4-5',
		provider: 'anthropic',
		pricing: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	},

	// Google models
	'gemini-3.1-pro-preview': {
		name: 'gemini-3.1-pro-preview',
		id: 'gemini-3.1-pro-preview',
		provider: 'google',
		thinking: true,
	},

	// gemini 3.8 flash is fast, stable, and strong at agentic work
	'gemini-3.8-flash': {
		name: 'gemini-3.8-flash',
		id: 'gemini-3.8-flash',
		provider: 'google',
	},

	// OpenAI models
	'gpt-5.5': {
		name: 'gpt-5.5',
		id: 'gpt-5.5',
		provider: 'openai',
	},

	'gpt-6.1-sol': {
		name: 'gpt-6.1-sol',
		id: 'gpt-6.1-sol',
		provider: 'openai',
	},
} as const satisfies Record<string, Omit<AgentModelDefinition, 'name'> & { name: string }>

export const DEFAULT_MODEL_NAME: AgentModelName = 'claude-sonnet-5-5'

/**
 * Check if a string is a valid AgentModelName.
 */
export function isValidModelName(value: string | undefined): value is AgentModelName {
	return !!value && value in AGENT_MODEL_DEFINITIONS
}

/**
 * Get the full information about a model from its name.
 * @param modelName - The name of the model.
 * @returns The full definition of the model.
 */
export function getAgentModelDefinition(modelName: AgentModelName): AgentModelDefinition {
	const definition: AgentModelDefinition | undefined = AGENT_MODEL_DEFINITIONS[modelName]
	if (!definition) {
		throw new Error(`Model ${modelName} not found`)
	}
	return definition
}

/** Token counts for one model response, as reported by the provider. */
export interface AgentUsage {
	modelName: string
	/** Uncached input tokens */
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
}

/** Estimated cost in USD, or null when we have no pricing for the model. */
export function estimateCost(usage: AgentUsage): number | null {
	if (!isValidModelName(usage.modelName)) return null
	const pricing = getAgentModelDefinition(usage.modelName).pricing
	if (!pricing) return null
	return (
		(usage.inputTokens * pricing.input +
			usage.outputTokens * pricing.output +
			usage.cacheReadTokens * pricing.cacheRead +
			usage.cacheWriteTokens * pricing.cacheWrite) /
		1_000_000
	)
}
