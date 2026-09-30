import { useEffect, useRef, useState } from 'react'
import { CommentBadge } from './CommentBadge'
import { PageThumbnail } from './PageThumbnail'
import { formatRelativeTime, PageSummary } from './pagesApi'

export interface PageCardActions {
	open(page: PageSummary): void
	togglePin(page: PageSummary): void
	rename(page: PageSummary): void
	duplicate(page: PageSummary): void
	editTags(page: PageSummary): void
	share(page: PageSummary): void
	remove(page: PageSummary): void
	filterByTag(tag: string): void
}

export function PageCard({
	page,
	unseen,
	currentUserId,
	actions,
}: {
	page: PageSummary
	unseen: boolean
	currentUserId?: string
	actions: PageCardActions
}) {
	const [menuOpen, setMenuOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!menuOpen) return
		const close = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
		}
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
		document.addEventListener('mousedown', close)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', close)
			document.removeEventListener('keydown', onKey)
		}
	}, [menuOpen])

	const editedAt = page.lastEditedAt ?? page.updatedAt
	const editedBy =
		page.lastEditedById === currentUserId ? 'You' : page.lastEditedByName ?? null
	const run = (fn: (p: PageSummary) => void) => () => {
		setMenuOpen(false)
		fn(page)
	}

	return (
		<article className={`home-card${unseen ? ' home-card--unseen' : ''}`}>
			<button className="home-card-open" onClick={() => actions.open(page)} aria-label={`Open ${page.name}`}>
				<PageThumbnail pageId={page.id} version={page.thumbnailUpdatedAt} />
			</button>
			<div className="home-card-body">
				<div className="home-card-title-row">
					<button className="home-card-title" onClick={() => actions.open(page)} title={page.name}>
						{page.name}
					</button>
					{page.pinned && (
						<span className="home-pin-indicator" title="Pinned" aria-label="Pinned">
							<PinIcon filled />
						</span>
					)}
					<div className="home-card-menu" ref={menuRef}>
						<button
							className="home-icon-btn"
							aria-label="Page actions"
							aria-expanded={menuOpen}
							onClick={() => setMenuOpen((o) => !o)}
						>
							⋯
						</button>
						{menuOpen && (
							<div className="home-menu" role="menu">
								<button role="menuitem" onClick={run(actions.togglePin)}>
									{page.pinned ? 'Unpin' : 'Pin to top'}
								</button>
								<button role="menuitem" onClick={run(actions.duplicate)}>
									Duplicate
								</button>
								{page.canEdit && (
									<button role="menuitem" onClick={run(actions.editTags)}>
										Edit tags…
									</button>
								)}
								{page.isOwner && (
									<>
										<button role="menuitem" onClick={run(actions.rename)}>
											Rename…
										</button>
										<button role="menuitem" onClick={run(actions.share)}>
											Share…
										</button>
										<hr />
										<button role="menuitem" className="home-menu-danger" onClick={run(actions.remove)}>
											Delete
										</button>
									</>
								)}
							</div>
						)}
					</div>
				</div>
				<div className="home-card-meta">
					{unseen && <span className="home-unseen-dot" aria-label="Changed since you last looked" />}
					<CommentBadge unread={page.unreadComments} mentions={page.unreadMentions} />
					<span>
						{editedBy ? `${editedBy} edited` : 'Edited'} {formatRelativeTime(editedAt)}
					</span>
					{!page.isOwner && <span className="home-card-owner">· {page.ownerName}</span>}
				</div>
				{page.tags.length > 0 && (
					<div className="home-card-tags">
						{page.tags.map((t) => (
							<button key={t} className="home-tag" onClick={() => actions.filterByTag(t)}>
								{t}
							</button>
						))}
					</div>
				)}
			</div>
		</article>
	)
}

export function PinIcon({ filled }: { filled?: boolean }) {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
			<path d="M16 3l5 5-4 1-4 4 1 5-2 2-4-4-5 5v-2l4-4-4-4 2-2 5 1 4-4z" strokeLinejoin="round" />
		</svg>
	)
}
