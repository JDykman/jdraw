import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google'
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai'
import { LanguageModel, ModelMessage, streamText } from 'ai'
import { AgentModelName, AgentUsage, getAgentModelDefinition, isValidModelName } from '../../shared/models'
import { DebugPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentAction } from '../../shared/types/AgentAction'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { Streaming } from '../../shared/types/Streaming'
import { Environment } from '../../server/environment'
import { buildMessages } from '../prompt/buildMessages'
import { buildSystemPrompt } from '../prompt/buildSystemPrompt'
import { getModelName } from '../prompt/getModelName'
import { closeAndParseJson } from './closeAndParseJson'
import { looksLikeInvokeMarkup, parseInvokeActions } from './parseInvokeActions'

export class AgentService {
	openai: OpenAIProvider
	anthropic: AnthropicProvider
	google: GoogleGenerativeAIProvider

	/** Token usage of the most recent completed stream (for the client's cost meter) */
	lastUsage: AgentUsage | null = null

	constructor(env: Environment) {
		this.openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
		this.anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
		this.google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })
	}

	getModel(modelName: AgentModelName): LanguageModel {
		const modelDefinition = getAgentModelDefinition(modelName)
		const provider = modelDefinition.provider
		return this[provider](modelDefinition.id)
	}

	async *stream(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
		try {
			for await (const event of this.streamActions(prompt)) {
				yield event
			}
		} catch (error: any) {
			console.error('Stream error:', error)
			throw error
		}
	}

	private async *streamActions(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
		const modelName = getModelName(prompt)
		const model = this.getModel(modelName)

		if (typeof model === 'string') {
			throw new Error('Model is a string, not a LanguageModel')
		}

		const { modelId, provider } = model
		if (!isValidModelName(modelId)) {
			throw new Error(`Model ${modelId} is not in AGENT_MODEL_DEFINITIONS`)
		}

		const modelDefinition = getAgentModelDefinition(modelId)
		// Newer Claude models reject assistant prefill, so the output format has to be spelled out
		// instead (and the reply is still parsed leniently, see stripToJson and the fallback below).
		const isModernAnthropic = !!modelDefinition.modernAnthropic
		const systemPrompt = buildSystemPrompt(prompt) + (isModernAnthropic ? OUTPUT_FORMAT_REMINDER : '')

		// Build messages with provider-specific options
		const messages: ModelMessage[] = []

		// Add system prompt with Anthropic caching if applicable
		if (provider === 'anthropic.messages') {
			// Anthropic requires explicit cache breakpoints. We set one at the end of the
			// system prompt to cache all system content (which generally changes together).
			messages.push({
				role: 'system',
				content: systemPrompt,
				providerOptions: {
					anthropic: { cacheControl: { type: 'ephemeral' } },
				},
			})
		} else {
			messages.push({
				role: 'system',
				content: systemPrompt,
			})
		}

		// Add prompt messages
		const promptMessages = buildMessages(prompt)
		messages.push(...promptMessages)

		// Check for debug flags and log if enabled
		const debugPart = prompt.debug as DebugPart | undefined
		if (debugPart) {
			if (debugPart.logSystemPrompt) {
				const promptWithoutSchema = buildSystemPrompt(prompt, { withSchema: false })
				console.log('[DEBUG] System Prompt (without schema):\n', promptWithoutSchema)
			}
			if (debugPart.logMessages) {
				console.log('[DEBUG] Messages:\n', JSON.stringify(promptMessages, null, 2))
			}
		}

		const canForceResponseStart =
			(provider === 'anthropic.messages' && !isModernAnthropic) || provider === 'google.generative-ai'

		// Add the assistant message to indicate the start of the actions
		if (canForceResponseStart) {
			messages.push({
				role: 'assistant',
				content: '{"actions": [{"_type":',
			})
		}

		// Configure thinking budgets based on model. We let models think using the think action, so we keep this as low as possible to minimize time to first token
		// Gemini: 256 for thinking models, 0 otherwise
		const geminiThinkingBudget = modelDefinition.thinking ? 256 : 0

		// OpenAI: 'low' is accepted by every current reasoning model (not all take 'none'/'minimal')
		const openaiReasoningEffort = 'low'

		try {
			const result = streamText({
				model,
				messages,
				// Modern Claude models always think, and thinking counts against this limit
				maxOutputTokens: isModernAnthropic ? 16000 : 8192,
				// Modern Claude models reject sampling params and can't disable thinking; low
				// effort keeps time-to-first-action short since the agent has its own think action.
				temperature: isModernAnthropic ? undefined : 0,
				providerOptions: {
					anthropic: isModernAnthropic
						? { thinking: { type: 'adaptive' }, effort: 'low' }
						: { thinking: { type: 'disabled' } },
					google: {
						thinkingConfig: { thinkingBudget: geminiThinkingBudget },
					},
					openai: {
						reasoningEffort: openaiReasoningEffort,
					},
				},
				onAbort() {
					console.warn('Stream actions aborted')
				},
				onError: ({ error }) => {
					console.error('Stream text error:', error)
					// Rethrow the underlying error (not the { error } wrapper) so the
					// route handler can send a meaningful message to the client
					throw error instanceof Error ? error : new Error(String(error))
				},
			})

			const { textStream } = result
			let buffer = canForceResponseStart ? '{"actions": [{"_type":' : ''
			let cursor = 0
			let yielded = 0
			let maybeIncompleteAction: AgentAction | null = null

			let startTime = Date.now()
			for await (const text of textStream) {
				buffer += text

				const partialObject = canForceResponseStart ? closeAndParseJson(buffer) : parseUnprefilledReply(buffer)
				if (!partialObject) continue

				const actions = partialObject.actions
				if (!Array.isArray(actions)) continue
				if (actions.length === 0) continue

				// If the events list is ahead of the cursor, we know we've completed the current event
				// We can complete the event and move the cursor forward
				if (actions.length > cursor) {
					const action = actions[cursor - 1] as AgentAction
					if (action) {
						yielded++
						yield {
							...action,
							complete: true,
							time: Date.now() - startTime,
						}
						maybeIncompleteAction = null
					}
					cursor++
				}

				// Now let's check the (potentially new) current event
				// And let's yield it in its (potentially incomplete) state
				const action = actions[cursor - 1] as AgentAction
				if (action) {
					// If we don't have an incomplete event yet, this is the start of a new one
					if (!maybeIncompleteAction) {
						startTime = Date.now()
					}

					maybeIncompleteAction = action

					// Yield the potentially incomplete event
					yielded++
					yield {
						...action,
						complete: false,
						time: Date.now() - startTime,
					}
				}
			}

			this.lastUsage = await readUsage(result, modelId).catch(() => null)

			// If we've finished receiving events, but there's still an incomplete event, we need to complete it
			if (maybeIncompleteAction) {
				yield {
					...maybeIncompleteAction,
					complete: true,
					time: Date.now() - startTime,
				}
			}

			// The model answered but not in the action format (e.g. plain prose). Show the answer
			// as a chat message rather than silently dropping it.
			const reply = canForceResponseStart ? '' : buffer.trim()
			if (yielded === 0 && reply) {
				console.warn(`[${modelId}] reply had no readable actions; showing it as a message:`, reply.slice(0, 500))
				yield {
					_type: 'message',
					text: stripCodeFence(reply),
					complete: true,
					time: Date.now() - startTime,
				} as Streaming<AgentAction>
			}
		} catch (error: any) {
			console.error('streamActions error:', error)
			throw error
		}
	}
}

const OUTPUT_FORMAT_REMINDER = `

## Output format

Reply with exactly one JSON object of the form {"actions": [ ... ]} that conforms to the schema above. Start your reply with \`{\`: no prose before or after it, no code fences, and no XML or function-call tags (these actions are not tools). To say something to the user, put a \`message\` action inside \`actions\`.
`

/**
 * Without prefill, a model may emit a preamble or a ```json fence before the JSON.
 * Drop everything before it so the partial parser sees only JSON. A bare array of actions is
 * wrapped as `{"actions": [...]}`.
 */
export function stripToJson(text: string): string {
	const objectStart = text.search(/\{\s*"actions"/)
	if (objectStart !== -1) return text.slice(objectStart)
	const arrayStart = text.search(/\[\s*\{\s*"_type"/)
	if (arrayStart !== -1) return `{"actions": ${text.slice(arrayStart)}`
	return ''
}

/** Parse a reply from a model that wasn't prefilled: JSON actions, or tool-call style markup. */
function parseUnprefilledReply(text: string): { actions: unknown[] } | null {
	if (looksLikeInvokeMarkup(text)) return { actions: parseInvokeActions(text) }
	return closeAndParseJson(stripToJson(text))
}

function stripCodeFence(text: string): string {
	const m = /^```\w*\n([\s\S]*?)\n?```$/.exec(text)
	return m ? m[1].trim() : text
}

async function readUsage(result: ReturnType<typeof streamText>, modelName: string): Promise<AgentUsage> {
	const [usage, metadata] = await Promise.all([result.usage, result.providerMetadata])
	const cacheRead = usage.cachedInputTokens ?? 0
	const anthropicWrite = metadata?.anthropic?.cacheCreationInputTokens
	const isAnthropic = metadata?.anthropic !== undefined
	return {
		modelName,
		// Anthropic reports uncached input separately; other providers include cached tokens in inputTokens
		inputTokens: Math.max(0, (usage.inputTokens ?? 0) - (isAnthropic ? 0 : cacheRead)),
		outputTokens: usage.outputTokens ?? 0,
		cacheReadTokens: cacheRead,
		cacheWriteTokens: typeof anthropicWrite === 'number' ? anthropicWrite : 0,
	}
}
