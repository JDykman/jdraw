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
}

export const AGENT_MODEL_DEFINITIONS = {
	// Anthropic models
	// sonnet 5.5 is recommended: fast and strong at structured output
	'claude-sonnet-5-5': {
		name: 'claude-sonnet-5-5',
		id: 'claude-sonnet-5-5',
		provider: 'anthropic',
		modernAnthropic: true,
	},

	'claude-opus-5-5': {
		name: 'claude-opus-5-5',
		id: 'claude-opus-5-5',
		provider: 'anthropic',
		modernAnthropic: true,
	},

	'claude-fable-5-1': {
		name: 'claude-fable-5-1',
		id: 'claude-fable-5-1',
		provider: 'anthropic',
		modernAnthropic: true,
	},

	// haiku 4.5 is the cheapest/fastest Claude option and still supports prefill
	'claude-haiku-4-5': {
		name: 'claude-haiku-4-5',
		id: 'claude-haiku-4-5',
		provider: 'anthropic',
	},

	// Google models
	'gemini-3-pro-preview': {
		name: 'gemini-3-pro-preview',
		id: 'gemini-3-pro-preview',
		provider: 'google',
		thinking: true,
	},

	// gemini 3 flash is fastest, and quite good
	'gemini-3-flash-preview': {
		name: 'gemini-3-flash-preview',
		id: 'gemini-3-flash-preview',
		provider: 'google',
	},

	// OpenAI models
	'gpt-5.2-2025-12-11': {
		name: 'gpt-5.2-2025-12-11',
		id: 'gpt-5.2-2025-12-11',
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
