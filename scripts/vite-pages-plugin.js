import fs from 'fs'
import path from 'path'

const PAGES_DIR =
	process.env.JDRAW_PAGES_DIR || path.join(process.env.HOME, 'Documents', 'jdraw', 'pages')

function ensurePagesDir() {
	if (!fs.existsSync(PAGES_DIR)) {
		fs.mkdirSync(PAGES_DIR, { recursive: true })
	}
}

/**
 * Vite plugin that adds API middleware for persisting tldraw pages to local files.
 * Pages are stored as JSON in ~/Documents/jdraw/pages/
 * @returns {import('vite').Plugin}
 */
export function pagesPlugin() {
	return {
		name: 'jdraw-pages',
		configureServer(server) {
			ensurePagesDir()

			server.middlewares.use('/api/pages', (req, res) => {
				// Parse URL to get page ID (strip query string)
				const urlPath = req.url?.split('?')[0] || '/'

				if (req.method === 'GET' && urlPath === '/') {
					// List all pages
					const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.json'))
					const pages = files.map((f) => {
						const id = f.replace('.json', '')
						const stat = fs.statSync(path.join(PAGES_DIR, f))
						return { id, modified: stat.mtimeMs }
					})
					pages.sort((a, b) => b.modified - a.modified)
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify(pages))
					return
				}

				const id = urlPath.slice(1) // strip leading /
				if (!id || id.includes('/') || id.includes('..')) {
					res.statusCode = 400
					res.end('Invalid page ID')
					return
				}

				const filePath = path.join(PAGES_DIR, `${id}.json`)

				if (req.method === 'GET') {
					if (!fs.existsSync(filePath)) {
						res.statusCode = 404
						res.end('Not found')
						return
					}
					res.setHeader('Content-Type', 'application/json')
					res.end(fs.readFileSync(filePath, 'utf-8'))
					return
				}

				if (req.method === 'PUT') {
					let body = ''
					req.on('data', (chunk) => (body += chunk))
					req.on('end', () => {
						ensurePagesDir()
						fs.writeFileSync(filePath, body, 'utf-8')
						res.setHeader('Content-Type', 'application/json')
						res.end(JSON.stringify({ ok: true }))
					})
					return
				}

				if (req.method === 'DELETE') {
					if (fs.existsSync(filePath)) {
						fs.unlinkSync(filePath)
					}
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ ok: true }))
					return
				}

				res.statusCode = 405
				res.end('Method not allowed')
			})
		},
	}
}
