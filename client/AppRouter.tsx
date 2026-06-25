import { Component, ReactNode, useCallback, useEffect, useState } from 'react'
import App from './App'
import { useAuth } from './auth/AuthContext'
import { LoginPage } from './auth/LoginPage'
import { PageListSidebar } from './pages/PageListSidebar'

function getCurrentPageStorageKey(userId: string) {
	return `jdraw:currentPageId:${userId}`
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	override state = { error: null as Error | null }
	static getDerivedStateFromError(error: Error) {
		return { error }
	}
	override componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error('RootErrorBoundary caught:', error, info)
	}
	override render() {
		if (this.state.error) {
			return (
				<div style={{ padding: 24, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
					<h2>Something crashed</h2>
					<p><strong>{this.state.error.name}:</strong> {this.state.error.message}</p>
					<pre style={{ fontSize: 12, overflow: 'auto' }}>{this.state.error.stack}</pre>
					<button onClick={() => this.setState({ error: null })}>Dismiss</button>
				</div>
			)
		}
		return this.props.children
	}
}

export function AppRouter() {
	const { user, loading } = useAuth()
	const [currentPageId, setCurrentPageId] = useState<string | null>(null)
	const [restoredForUserId, setRestoredForUserId] = useState<string | null>(null)

	useEffect(() => {
		if (!user) {
			setCurrentPageId(null)
			setRestoredForUserId(null)
			return
		}

		setCurrentPageId(localStorage.getItem(getCurrentPageStorageKey(user.id)))
		setRestoredForUserId(user.id)
	}, [user])

	const handleSelectPage = useCallback((pageId: string) => {
		if (user) localStorage.setItem(getCurrentPageStorageKey(user.id), pageId)
		setCurrentPageId(pageId)
	}, [user])

	const handleBackToPages = useCallback(() => {
		if (user) localStorage.removeItem(getCurrentPageStorageKey(user.id))
		setCurrentPageId(null)
	}, [user])

	if (loading) {
		return (
			<div className="app-loading">
				<span>Loading…</span>
			</div>
		)
	}

	if (!user) {
		return <LoginPage />
	}

	if (restoredForUserId !== user.id) {
		return (
			<div className="app-loading">
				<span>Loading…</span>
			</div>
		)
	}

	if (!currentPageId) {
		return <PageListSidebar onSelect={handleSelectPage} />
	}

	return (
		<RootErrorBoundary>
			<App pageId={currentPageId} onBack={handleBackToPages} />
		</RootErrorBoundary>
	)
}
