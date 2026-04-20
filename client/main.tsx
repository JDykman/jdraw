import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppRouter } from './AppRouter'
import { AuthProvider } from './auth/AuthContext'
import './index.css'

window.addEventListener('error', (e) => {
	console.error('[window.error]', e.message, 'at', e.filename + ':' + e.lineno + ':' + e.colno, e.error)
})
window.addEventListener('unhandledrejection', (e) => {
	console.error('[unhandledrejection]', e.reason)
})

const root = document.getElementById('root') as HTMLElement
const mo = new MutationObserver((muts) => {
	for (const m of muts) {
		if (m.type === 'childList') {
			for (const removed of m.removedNodes) {
				console.warn('[DOM childList removed]', m.target, '→', removed)
			}
		} else if (m.type === 'attributes') {
			const t = m.target as HTMLElement
			if (m.attributeName === 'style' || m.attributeName === 'class' || m.attributeName === 'hidden') {
				console.warn('[DOM attr]', m.attributeName, 'on', t.tagName + (t.className ? '.' + t.className : ''), '→', t.getAttribute(m.attributeName))
			}
		}
	}
})
mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] })

setInterval(() => {
	const container = document.querySelector('.tldraw-agent-container') as HTMLElement | null
	const canvas = document.querySelector('.tldraw-canvas') as HTMLElement | null
	if (container) {
		const cs = getComputedStyle(container)
		if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
			console.error('[visibility] container hidden:', cs.display, cs.visibility, cs.opacity)
		}
	}
	if (canvas) {
		const rect = canvas.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) console.error('[visibility] canvas zero size:', rect)
	}
}, 2000)

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<AuthProvider>
			<AppRouter />
		</AuthProvider>
	</React.StrictMode>
)
