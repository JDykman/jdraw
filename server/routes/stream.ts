import { Router } from 'express'
import { AgentService } from '../../worker/do/AgentService.js'
import { getUserKeys } from './keys.js'

const router = Router()

router.post('/', async (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	})

	const keys = getUserKeys(req.user!.id)

	if (!keys.openai && !keys.anthropic && !keys.google) {
		res.write(`data: ${JSON.stringify({ error: 'No API keys configured. Add your API keys in Settings.' })}\n\n`)
		res.end()
		return
	}

	const service = new AgentService({
		OPENAI_API_KEY: keys.openai,
		ANTHROPIC_API_KEY: keys.anthropic,
		GOOGLE_API_KEY: keys.google,
	})

	try {
		for await (const change of service.stream(req.body)) {
			res.write(`data: ${JSON.stringify(change)}\n\n`)
		}
	} catch (err: unknown) {
		res.write(`data: ${JSON.stringify({ error: getErrorMessage(err) })}\n\n`)
	}
	res.end()
})

/** Extract a human-readable message from an unknown error, unwrapping { error } wrappers. */
function getErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message
	if (err && typeof err === 'object') {
		const { error, message } = err as { error?: unknown; message?: unknown }
		if (error !== undefined && error !== err) return getErrorMessage(error)
		if (typeof message === 'string') return message
	}
	return String(err)
}

export default router
