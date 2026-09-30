import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LanguageModel, simulateReadableStream } from 'ai'
import { AgentModelName } from '../../shared/models'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { AgentService } from '../do/AgentService'

function mockModel(modelId: string, provider: string, text: string) {
	const chunks = [
		{ type: 'text-start' as const, id: '1' },
		...text.match(/[\s\S]{1,7}/g)!.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
		{ type: 'text-end' as const, id: '1' },
		{
			type: 'finish' as const,
			finishReason: 'stop' as const,
			usage: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280, cachedInputTokens: 3000 },
			providerMetadata: { anthropic: { cacheCreationInputTokens: 500 } },
		},
	]
	// Minimal LanguageModelV2 (ai/test's mock pulls in msw)
	const doStreamCalls: any[] = []
	return {
		specificationVersion: 'v2' as const,
		provider,
		modelId,
		supportedUrls: {},
		doStreamCalls,
		doGenerate: async () => {
			throw new Error('not used')
		},
		doStream: async (options: any) => {
			doStreamCalls.push(options)
			return { stream: simulateReadableStream({ chunks }) }
		},
	}
}

type MockModel = ReturnType<typeof mockModel>

class TestService extends AgentService {
	constructor(private model: MockModel) {
		super({ OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_API_KEY: '' })
	}
	override getModel(_: AgentModelName): LanguageModel {
		return this.model as unknown as LanguageModel
	}
}

function prompt(modelName: string): AgentPrompt {
	return {
		mode: { type: 'mode', modeType: 'working', partTypes: ['messages'], actionTypes: ['message', 'think'] },
		modelName: { type: 'modelName', modelName },
		messages: { type: 'messages', agentMessages: ['hi'], requestSource: 'user' },
	} as unknown as AgentPrompt
}

async function collect(service: AgentService, p: AgentPrompt) {
	const out = []
	for await (const a of service.stream(p)) out.push(a)
	return out
}

describe('AgentService with modern Claude models', () => {
	it('sends no prefill or temperature, strips a preamble, and reports usage', async () => {
		const model = mockModel(
			'claude-sonnet-5-5',
			'anthropic.messages',
			'Sure! Here is my response:\n```json\n{"actions": [{"_type":"think","text":"plan"},{"_type":"message","text":"Done."}]}\n```'
		)
		const service = new TestService(model)
		const actions = await collect(service, prompt('claude-sonnet-5-5'))

		const complete = actions.filter((a) => a.complete)
		assert.deepEqual(
			complete.map((a) => a._type),
			['think', 'message']
		)
		assert.equal((complete[1] as { text: string }).text, 'Done.')

		const call = model.doStreamCalls[0]
		assert.equal(call.temperature, undefined)
		assert.equal(call.prompt.at(-1)?.role, 'user', 'last message must not be an assistant prefill')
		assert.deepEqual(call.providerOptions?.anthropic, { thinking: { type: 'adaptive' }, effort: 'low' })

		// Anthropic input tokens exclude cache reads/writes, which are reported separately
		assert.deepEqual(service.lastUsage, {
			modelName: 'claude-sonnet-5-5',
			inputTokens: 1200,
			outputTokens: 80,
			cacheReadTokens: 3000,
			cacheWriteTokens: 500,
		})
	})

	it('keeps the prefill and temperature 0 for Haiku 4.5', async () => {
		// With prefill the model continues after `{"actions": [{"_type":`
		const model = mockModel('claude-haiku-4-5', 'anthropic.messages', ' "message", "text": "Hi"}]}')
		const service = new TestService(model)
		const actions = await collect(service, prompt('claude-haiku-4-5'))
		assert.equal(actions.filter((a) => a.complete)[0]?._type, 'message')
		const call = model.doStreamCalls[0]
		assert.equal(call.temperature, 0)
		assert.equal(call.prompt.at(-1)?.role, 'assistant')
	})
})
