import { Component, ReactNode, useState } from 'react'
import App from './App'
import { useAuth } from './auth/AuthContext'
import { LoginPage } from './auth/LoginPage'
import { PageListSidebar } from './pages/PageListSidebar'

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null }
	static getDerivedStateFromError(error: Error) {
		return { error }
	}
	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error('RootErrorBoundary caught:', error, info)
	}
	render() {
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

	if (!currentPageId) {
		return <PageListSidebar onSelect={setCurrentPageId} />
	}

	return (
		<RootErrorBoundary>
			<App pageId={currentPageId} onBack={() => setCurrentPageId(null)} />
		</RootErrorBoundary>
	)
}
