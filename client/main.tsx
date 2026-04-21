import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppRouter } from './AppRouter'
import { AuthProvider } from './auth/AuthContext'
import './index.css'

// Global Error Logging & Visual Reporter
function reportError(type: string, error: any, info?: string) {
	const msg = error?.message || String(error)
	const stack = error?.stack || ''
	console.error(`[${type}]`, msg, info || '', error)

	// Create a visual overlay so we can see the error even if the console is cleared
	const overlay = document.createElement('div')
	overlay.style.position = 'fixed'
	overlay.style.top = '0'
	overlay.style.left = '0'
	overlay.style.width = '100%'
	overlay.style.background = 'red'
	overlay.style.color = 'white'
	overlay.style.padding = '10px'
	overlay.style.zIndex = '100000'
	overlay.style.fontSize = '12px'
	overlay.style.fontFamily = 'monospace'
	overlay.style.whiteSpace = 'pre-wrap'
	overlay.innerText = `FATAL ERROR [${type}]: ${msg}\n${stack}\n${info || ''}`
	document.body.appendChild(overlay)
}

window.addEventListener('error', (e) => reportError('window.error', e.error, `${e.filename}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason))

const root = document.getElementById('root') as HTMLElement

let hasLoadedCanvas = false
// Periodically check if the root is empty
setInterval(() => {
	if (root.innerHTML.length === 0) {
		console.warn('[DOM Check] Root is empty!')
	} else {
		// Log a heartbeat to know the script is alive
		console.log('[Heartbeat] Root innerHTML length:', root.innerHTML.length)
		if (root.innerHTML.length > 10000) {
			hasLoadedCanvas = true
		}
		if (hasLoadedCanvas && root.innerHTML.length < 1000 && !document.getElementById('debug-dump')) {
			console.log('[Heartbeat DOM]', root.innerHTML)
			const dump = document.createElement('div')
			dump.id = 'debug-dump'
			dump.style.position = 'fixed'
			dump.style.top = '0'
			dump.style.left = '0'
			dump.style.width = '100vw'
			dump.style.height = '100vh'
			dump.style.background = 'blue'
			dump.style.color = 'white'
			dump.style.zIndex = '999999'
			dump.style.padding = '20px'
			dump.style.overflow = 'auto'
			dump.innerText = "DOM DROPPED TO " + root.innerHTML.length + " CHARS:\n\n" + root.innerHTML
			document.body.appendChild(dump)
		}
	}
}, 2000)

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<AuthProvider>
			<AppRouter />
		</AuthProvider>
	</React.StrictMode>
)
