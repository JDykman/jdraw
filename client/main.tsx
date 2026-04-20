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

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<AuthProvider>
			<AppRouter />
		</AuthProvider>
	</React.StrictMode>
)
