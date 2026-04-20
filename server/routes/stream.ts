import { Router } from 'express'
import { AgentService } from '../../worker/do/AgentService.js'
import { env } from '../environment.js'

const router = Router()
const service = new AgentService(env)

router.post('/', async (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
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
