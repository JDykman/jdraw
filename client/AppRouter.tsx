import { useState } from 'react'
import App from './App'
import { useAuth } from './auth/AuthContext'
import { LoginPage } from './auth/LoginPage'
import { PageListSidebar } from './pages/PageListSidebar'

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

	return <App pageId={currentPageId} onBack={() => setCurrentPageId(null)} />
}
