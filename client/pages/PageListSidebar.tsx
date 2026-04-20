import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ApiKeysSettings } from '../components/ApiKeysSettings'

interface Page {
	id: string
	name: string
	owner_id: string
	isOwner: boolean
	canEdit: boolean
}

interface Share {
	id: string
	username: string
	can_edit: number
}

interface AllUser {
	id: string
	username: string
}

interface PageListProps {
	onSelect(pageId: string): void
}

export function PageListSidebar({ onSelect }: PageListProps) {
	const { user, getToken, logout } = useAuth()
	const [owned, setOwned] = useState<Page[]>([])
	const [shared, setShared] = useState<Page[]>([])
	const [newName, setNewName] = useState('')
	const [renaming, setRenaming] = useState<string | null>(null)
	const [renameValue, setRenameValue] = useState('')
	const renameRef = useRef<HTMLInputElement>(null)

	const [showSettings, setShowSettings] = useState(false)

	// Sharing modal state
	const [sharingPage, setSharingPage] = useState<Page | null>(null)
	const [shares, setShares] = useState<Share[]>([])
	const [allUsers, setAllUsers] = useState<AllUser[]>([])

	const authHeaders = useCallback(
		(): HeadersInit => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }),
		[getToken]
	)

	const loadPages = useCallback(async () => {
		const r = await fetch('/api/pages', { headers: authHeaders() })
		if (!r.ok) return
		const data = await r.json() as { owned: Page[]; shared: Page[] }
		setOwned(data.owned)
		setShared(data.shared)
	}, [authHeaders])

	useEffect(() => { loadPages() }, [loadPages])

	async function createPage(e: FormEvent) {
		e.preventDefault()
		if (!newName.trim()) return
		const r = await fetch('/api/pages', {
			method: 'POST',
			headers: authHeaders(),
			body: JSON.stringify({ name: newName.trim() }),
		})
		if (r.ok) {
			setNewName('')
			loadPages()
		}
	}

	function startRename(page: Page) {
		setRenaming(page.id)
		setRenameValue(page.name)
		setTimeout(() => renameRef.current?.select(), 0)
	}

	async function submitRename(pageId: string) {
		if (!renameValue.trim()) { setRenaming(null); return }
		await fetch(`/api/pages/${pageId}`, {
			method: 'PATCH',
			headers: authHeaders(),
			body: JSON.stringify({ name: renameValue.trim() }),
		})
		setRenaming(null)
		loadPages()
	}

	async function deletePage(pageId: string) {
		if (!confirm('Delete this page? This cannot be undone.')) return
		await fetch(`/api/pages/${pageId}`, { method: 'DELETE', headers: authHeaders() })
		loadPages()
	}

	async function openSharing(page: Page) {
		setSharingPage(page)
		const [sharesRes, usersRes] = await Promise.all([
			fetch(`/api/pages/${page.id}/shares`, { headers: authHeaders() }),
			fetch('/api/users', { headers: authHeaders() }),
		])
		if (sharesRes.ok) setShares(await sharesRes.json() as Share[])
		if (usersRes.ok) {
			const users = await usersRes.json() as AllUser[]
			// Exclude self
			setAllUsers(users.filter((u) => u.id !== user?.id))
		}
	}

	async function toggleShare(pageId: string, userId: string, currentlyShared: boolean) {
		if (currentlyShared) {
			await fetch(`/api/pages/${pageId}/shares/${userId}`, {
				method: 'DELETE',
				headers: authHeaders(),
			})
		} else {
			await fetch(`/api/pages/${pageId}/shares`, {
				method: 'POST',
				headers: authHeaders(),
				body: JSON.stringify({ userId, canEdit: true }),
			})
		}
		if (sharingPage) openSharing(sharingPage)
	}

	function renderPage(page: Page) {
		return (
			<div key={page.id} className="page-item">
				{renaming === page.id ? (
					<input
						ref={renameRef}
						className="page-rename-input"
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						onBlur={() => submitRename(page.id)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') submitRename(page.id)
							if (e.key === 'Escape') setRenaming(null)
						}}
					/>
				) : (
					<button className="page-name" onClick={() => onSelect(page.id)}>
						{page.name}
					</button>
				)}
				<div className="page-actions">
					{page.isOwner && (
						<>
							<button title="Share" onClick={() => openSharing(page)}>👥</button>
							<button title="Rename" onClick={() => startRename(page)}>✏️</button>
							<button title="Delete" onClick={() => deletePage(page.id)}>🗑️</button>
						</>
					)}
				</div>
			</div>
		)
	}

	return (
		<div className="page-list-sidebar">
			<div className="page-list-header">
				<span className="page-list-title">jdraw</span>
				<span className="page-list-user">{user?.username}</span>
				<button className="page-list-settings" onClick={() => setShowSettings(true)} title="API Keys">⚙</button>
				<button className="page-list-logout" onClick={logout}>Sign out</button>
			</div>

			<form className="page-create-form" onSubmit={createPage}>
				<input
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					placeholder="New page name…"
				/>
				<button type="submit" disabled={!newName.trim()}>Create</button>
			</form>

			<section>
				<h2>My pages</h2>
				{owned.length === 0 ? (
					<p className="page-list-empty">No pages yet. Create one above.</p>
				) : (
					owned.map(renderPage)
				)}
			</section>

			{shared.length > 0 && (
				<section>
					<h2>Shared with me</h2>
					{shared.map(renderPage)}
				</section>
			)}

			{sharingPage && (
				<div className="sharing-modal-overlay" onClick={() => setSharingPage(null)}>
					<div className="sharing-modal" onClick={(e) => e.stopPropagation()}>
						<div className="sharing-modal-header">
							<h3>Share "{sharingPage.name}"</h3>
							<button onClick={() => setSharingPage(null)}>✕</button>
						</div>
						<div className="sharing-modal-body">
							{allUsers.length === 0 ? (
								<p>No other users yet.</p>
							) : (
								allUsers.map((u) => {
									const isShared = shares.some((s) => s.id === u.id)
									return (
										<div key={u.id} className="sharing-user-row">
											<span>{u.username}</span>
											<button
												className={isShared ? 'btn-remove-share' : 'btn-add-share'}
												onClick={() => toggleShare(sharingPage.id, u.id, isShared)}
											>
												{isShared ? 'Remove' : 'Add'}
											</button>
										</div>
									)
								})
							)}
						</div>
					</div>
				</div>
			)}
			{showSettings && <ApiKeysSettings onClose={() => setShowSettings(false)} />}
		</div>
	)
}
