import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PageSummary, useApi } from './pagesApi'

export function Dialog({
	title,
	onClose,
	children,
	footer,
}: {
	title: string
	onClose(): void
	children: ReactNode
	footer?: ReactNode
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	return createPortal(
		<div className="home-dialog-overlay" onMouseDown={onClose}>
			<div
				className="home-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="home-dialog-header">
					<h3>{title}</h3>
					<button className="home-icon-btn" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				<div className="home-dialog-body">{children}</div>
				{footer && <div className="home-dialog-footer">{footer}</div>}
			</div>
		</div>,
		document.body
	)
}

/** Single text field dialog, used for new page and rename. */
export function PromptDialog({
	title,
	label,
	initialValue = '',
	submitLabel,
	onSubmit,
	onClose,
	children,
}: {
	title: string
	label: string
	initialValue?: string
	submitLabel: string
	onSubmit(value: string): Promise<void> | void
	onClose(): void
	children?: ReactNode
}) {
	const [value, setValue] = useState(initialValue)
	const [busy, setBusy] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		inputRef.current?.select()
	}, [])

	async function submit(e: FormEvent) {
		e.preventDefault()
		if (!value.trim() || busy) return
		setBusy(true)
		try {
			await onSubmit(value.trim())
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog title={title} onClose={onClose}>
			<form className="home-form" onSubmit={submit}>
				<label className="home-field">
					<span>{label}</span>
					<input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
				</label>
				{children}
				<div className="home-dialog-actions">
					<button type="button" className="home-btn" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" className="home-btn home-btn--primary" disabled={!value.trim() || busy}>
						{submitLabel}
					</button>
				</div>
			</form>
		</Dialog>
	)
}

export function TagsDialog({
	page,
	allTags,
	onSave,
	onClose,
}: {
	page: PageSummary
	allTags: string[]
	onSave(tags: string[]): Promise<void>
	onClose(): void
}) {
	const [tags, setTags] = useState<string[]>(page.tags)
	const [draft, setDraft] = useState('')

	const suggestions = useMemo(
		() => allTags.filter((t) => !tags.includes(t) && t.includes(draft.trim().toLowerCase())).slice(0, 12),
		[allTags, tags, draft]
	)

	function add(raw: string) {
		const tag = raw.trim().toLowerCase().replace(/\s+/g, '-')
		if (tag && !tags.includes(tag)) setTags([...tags, tag])
		setDraft('')
	}

	return (
		<Dialog title={`Tags for “${page.name}”`} onClose={onClose}>
			<div className="home-form">
				<div className="home-tag-editor">
					{tags.map((t) => (
						<span key={t} className="home-tag home-tag--removable">
							{t}
							<button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
								✕
							</button>
						</span>
					))}
					<input
						value={draft}
						placeholder={tags.length ? 'Add another…' : 'Add a tag…'}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ',') {
								e.preventDefault()
								add(draft)
							} else if (e.key === 'Backspace' && !draft && tags.length) {
								setTags(tags.slice(0, -1))
							}
						}}
						autoFocus
					/>
				</div>
				{suggestions.length > 0 && (
					<div className="home-tag-suggestions">
						{suggestions.map((t) => (
							<button key={t} className="home-tag" onClick={() => add(t)}>
								+ {t}
							</button>
						))}
					</div>
				)}
				<div className="home-dialog-actions">
					<button className="home-btn" onClick={onClose}>
						Cancel
					</button>
					<button
						className="home-btn home-btn--primary"
						onClick={async () => {
							await onSave(draft.trim() ? [...tags, draft.trim().toLowerCase()] : tags)
							onClose()
						}}
					>
						Save
					</button>
				</div>
			</div>
		</Dialog>
	)
}

interface Share {
	id: string
	username: string
	can_edit: number
}

interface UserRow {
	id: string
	username: string
}

export function ShareDialog({ page, currentUserId, onClose }: { page: PageSummary; currentUserId?: string; onClose(): void }) {
	const api = useApi()
	const [shares, setShares] = useState<Share[]>([])
	const [users, setUsers] = useState<UserRow[] | null>(null)

	async function load() {
		const [s, u] = await Promise.all([api<Share[]>(`/pages/${page.id}/shares`), api<UserRow[]>('/users')])
		setShares(s)
		setUsers(u.filter((x) => x.id !== currentUserId))
	}

	useEffect(() => {
		load().catch(() => setUsers([]))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page.id])

	async function toggle(userId: string, shared: boolean) {
		if (shared) {
			await api(`/pages/${page.id}/shares/${userId}`, { method: 'DELETE' })
		} else {
			await api(`/pages/${page.id}/shares`, { method: 'POST', json: { userId, canEdit: true } })
		}
		await load()
	}

	return (
		<Dialog title={`Share “${page.name}”`} onClose={onClose}>
			{users === null ? (
				<p className="home-muted">Loading…</p>
			) : users.length === 0 ? (
				<p className="home-muted">No other users yet.</p>
			) : (
				<ul className="home-share-list">
					{users.map((u) => {
						const shared = shares.some((s) => s.id === u.id)
						return (
							<li key={u.id}>
								<span className="home-avatar" aria-hidden="true">
									{u.username.slice(0, 1).toUpperCase()}
								</span>
								<span className="home-share-name">{u.username}</span>
								<button
									className={`home-btn home-btn--small${shared ? '' : ' home-btn--primary'}`}
									onClick={() => toggle(u.id, shared)}
								>
									{shared ? 'Remove' : 'Add'}
								</button>
							</li>
						)
					})}
				</ul>
			)}
		</Dialog>
	)
}
