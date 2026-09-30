import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ApiKeysSettings } from '../components/ApiKeysSettings'
import { NewPageDialog, PromptDialog, ShareDialog, TagsDialog } from './HomeDialogs'
import { PageCard, PageCardActions } from './PageCard'
import { hasUnseenEdits, PageSummary, usePages } from './pagesApi'
import { setPendingTemplate } from './templates'
import { useHomeTheme } from './useHomeTheme'
import './home.css'

type SortKey = 'recent' | 'name' | 'owner' | 'created'
type OwnerFilter = 'all' | 'mine' | 'shared'

const PREFS_KEY = 'jdraw:homePrefs'

interface HomePrefs {
	sort: SortKey
	owner: OwnerFilter
}

function loadPrefs(): HomePrefs {
	try {
		const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<HomePrefs>
		return { sort: saved.sort ?? 'recent', owner: saved.owner ?? 'all' }
	} catch {
		return { sort: 'recent', owner: 'all' }
	}
}

const byName = (a: PageSummary, b: PageSummary) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
const SORTERS: Record<SortKey, (a: PageSummary, b: PageSummary) => number> = {
	recent: (a, b) => (b.lastEditedAt ?? b.updatedAt) - (a.lastEditedAt ?? a.updatedAt),
	name: byName,
	owner: (a, b) => a.ownerName.localeCompare(b.ownerName) || byName(a, b),
	created: (a, b) => b.createdAt - a.createdAt,
}

type Dialog =
	| { type: 'new' }
	| { type: 'rename'; page: PageSummary }
	| { type: 'tags'; page: PageSummary }
	| { type: 'share'; page: PageSummary }
	| { type: 'settings' }
	| null

export function HomePage({ onSelect }: { onSelect(pageId: string): void }) {
	const { user, logout } = useAuth()
	const { pages, error, setError, mutate, api } = usePages()
	const [prefs, setPrefs] = useState<HomePrefs>(loadPrefs)
	const [query, setQuery] = useState('')
	const [activeTags, setActiveTags] = useState<string[]>([])
	const [dialog, setDialog] = useState<Dialog>(null)
	const searchRef = useRef<HTMLInputElement>(null)
	const theme = useHomeTheme()

	useEffect(() => {
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
		} catch {
			// Storage unavailable; prefs just won't persist
		}
	}, [prefs])

	// "/" focuses search, "n" opens the new-page dialog
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement
			if (dialog || target.closest('input, textarea, select, [contenteditable]')) return
			if (e.key === '/') {
				e.preventDefault()
				searchRef.current?.focus()
			} else if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault()
				setDialog({ type: 'new' })
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [dialog])

	const allTags = useMemo(() => [...new Set((pages ?? []).flatMap((p) => p.tags))].sort(), [pages])

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase()
		return (pages ?? [])
			.filter((p) => prefs.owner === 'all' || (prefs.owner === 'mine') === p.isOwner)
			.filter((p) => activeTags.every((t) => p.tags.includes(t)))
			.filter(
				(p) =>
					!q ||
					p.name.toLowerCase().includes(q) ||
					p.ownerName.toLowerCase().includes(q) ||
					p.tags.some((t) => t.includes(q))
			)
			.sort(SORTERS[prefs.sort])
	}, [pages, prefs, query, activeTags])

	const pinned = visible.filter((p) => p.pinned)
	const rest = visible.filter((p) => !p.pinned)
	const unseenCount = (pages ?? []).filter((p) => hasUnseenEdits(p, user?.id)).length
	const isFiltered = query.trim() !== '' || activeTags.length > 0 || prefs.owner !== 'all'

	const toggleTag = useCallback(
		(tag: string) => setActiveTags((tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])),
		[]
	)

	const actions: PageCardActions = {
		open: (page) => onSelect(page.id),
		togglePin: (page) =>
			mutate(
				(ps) => ps.map((p) => (p.id === page.id ? { ...p, pinned: !p.pinned } : p)),
				() => api(`/pages/${page.id}/pin`, { method: page.pinned ? 'DELETE' : 'PUT' })
			),
		rename: (page) => setDialog({ type: 'rename', page }),
		duplicate: (page) =>
			mutate(
				(ps) => ps,
				() => api(`/pages/${page.id}/duplicate`, { method: 'POST', json: {} })
			),
		editTags: (page) => setDialog({ type: 'tags', page }),
		share: (page) => setDialog({ type: 'share', page }),
		remove: (page) => {
			if (!confirm(`Delete “${page.name}”? This cannot be undone.`)) return
			mutate(
				(ps) => ps.filter((p) => p.id !== page.id),
				() => api(`/pages/${page.id}`, { method: 'DELETE' })
			)
		},
		filterByTag: (tag) => setActiveTags((tags) => (tags.includes(tag) ? tags : [...tags, tag])),
	}

	const renderGrid = (list: PageSummary[]) => (
		<div className="home-grid">
			{list.map((page) => (
				<PageCard
					key={page.id}
					page={page}
					unseen={hasUnseenEdits(page, user?.id)}
					currentUserId={user?.id}
					actions={actions}
				/>
			))}
		</div>
	)

	return (
		<div className="home">
			<header className="home-header">
				<div className="home-brand">jdraw</div>
				<div className="home-search">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
						<circle cx="11" cy="11" r="7" />
						<path d="M20 20l-4-4" strokeLinecap="round" />
					</svg>
					<input
						ref={searchRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), searchRef.current?.blur())}
						placeholder="Search pages, tags, people"
						aria-label="Search pages"
					/>
					<kbd>/</kbd>
				</div>
				<div className="home-header-right">
					<button className="home-btn home-btn--primary" onClick={() => setDialog({ type: 'new' })}>
						+ New page
					</button>
					<button
						className="home-icon-btn"
						onClick={theme.cycle}
						title={`Theme: ${theme.scheme} (click to change)`}
						aria-label={`Theme: ${theme.scheme}. Change theme`}
					>
						{theme.scheme === 'light' ? '☀︎' : theme.scheme === 'dark' ? '☾' : '◐'}
					</button>
					<button className="home-icon-btn" onClick={() => setDialog({ type: 'settings' })} title="API keys" aria-label="API keys">
						⚙
					</button>
					<span className="home-avatar" title={user?.username} aria-hidden="true">
						{user?.username.slice(0, 1).toUpperCase()}
					</span>
					<button className="home-btn home-btn--ghost" onClick={logout}>
						Sign out
					</button>
				</div>
			</header>

			<div className="home-toolbar">
				<div className="home-segmented" role="group" aria-label="Owner filter">
					{(['all', 'mine', 'shared'] as const).map((o) => (
						<button
							key={o}
							aria-pressed={prefs.owner === o}
							onClick={() => setPrefs((p) => ({ ...p, owner: o }))}
						>
							{o === 'all' ? 'All' : o === 'mine' ? 'Mine' : 'Shared with me'}
						</button>
					))}
				</div>
				{allTags.length > 0 && (
					<div className="home-tag-filter" aria-label="Filter by tag">
						{allTags.map((t) => (
							<button
								key={t}
								className="home-tag"
								aria-pressed={activeTags.includes(t)}
								onClick={() => toggleTag(t)}
							>
								{t}
							</button>
						))}
					</div>
				)}
				<label className="home-sort">
					<span>Sort</span>
					<select value={prefs.sort} onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as SortKey }))}>
						<option value="recent">Recently edited</option>
						<option value="name">Name</option>
						<option value="owner">Owner</option>
						<option value="created">Newest</option>
					</select>
				</label>
			</div>

			{error && (
				<div className="home-error" role="alert">
					{error}
					<button className="home-icon-btn" onClick={() => setError(null)} aria-label="Dismiss">
						✕
					</button>
				</div>
			)}

			<main className="home-main">
				{pages === null ? (
					<div className="home-grid">
						{Array.from({ length: 6 }, (_, i) => (
							<div key={i} className="home-card home-card--skeleton" />
						))}
					</div>
				) : pages.length === 0 ? (
					<div className="home-empty">
						<h2>No pages yet</h2>
						<p>Create your first canvas and start drawing, or ask the agent to draw for you.</p>
						<button className="home-btn home-btn--primary" onClick={() => setDialog({ type: 'new' })}>
							+ New page
						</button>
					</div>
				) : visible.length === 0 ? (
					<div className="home-empty">
						<h2>No matches</h2>
						<p>Nothing matches the current search and filters.</p>
						<button
							className="home-btn"
							onClick={() => {
								setQuery('')
								setActiveTags([])
								setPrefs((p) => ({ ...p, owner: 'all' }))
							}}
						>
							Clear filters
						</button>
					</div>
				) : (
					<>
						{pinned.length > 0 && (
							<section>
								<h2 className="home-section-title">Pinned</h2>
								{renderGrid(pinned)}
							</section>
						)}
						{rest.length > 0 && (
							<section>
								<h2 className="home-section-title">
									{isFiltered ? `${visible.length} ${visible.length === 1 ? 'page' : 'pages'}` : 'All pages'}
									{unseenCount > 0 && !isFiltered && (
										<span className="home-section-note">
											<span className="home-unseen-dot" /> {unseenCount} changed since you last looked
										</span>
									)}
								</h2>
								{renderGrid(rest)}
							</section>
						)}
					</>
				)}
			</main>

			{dialog?.type === 'new' && (
				<NewPageDialog
					onClose={() => setDialog(null)}
					onCreate={async (name, template) => {
						const created = await api<{ id: string }>('/pages', { method: 'POST', json: { name } })
						setPendingTemplate(created.id, template)
						setDialog(null)
						onSelect(created.id)
					}}
				/>
			)}
			{dialog?.type === 'rename' && (
				<PromptDialog
					title="Rename page"
					label="Name"
					initialValue={dialog.page.name}
					submitLabel="Rename"
					onClose={() => setDialog(null)}
					onSubmit={async (name) => {
						const id = dialog.page.id
						setDialog(null)
						await mutate(
							(ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)),
							() => api(`/pages/${id}`, { method: 'PATCH', json: { name } })
						)
					}}
				/>
			)}
			{dialog?.type === 'tags' && (
				<TagsDialog
					page={dialog.page}
					allTags={allTags}
					onClose={() => setDialog(null)}
					onSave={(tags) =>
						mutate(
							(ps) => ps.map((p) => (p.id === dialog.page.id ? { ...p, tags } : p)),
							() => api(`/pages/${dialog.page.id}/tags`, { method: 'PUT', json: { tags } })
						)
					}
				/>
			)}
			{dialog?.type === 'share' && (
				<ShareDialog page={dialog.page} currentUserId={user?.id} onClose={() => setDialog(null)} />
			)}
			{dialog?.type === 'settings' && <ApiKeysSettings onClose={() => setDialog(null)} />}
		</div>
	)
}
