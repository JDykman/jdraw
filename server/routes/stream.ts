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
		const message = err instanceof Error ? err.message : String(err)
		res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
	}
	res.end()
})

export default router
