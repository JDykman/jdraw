/** Unread comment count for a homepage card, with an @ marker when any of them mention the user. */
export function CommentBadge({ unread, mentions }: { unread: number; mentions: number }) {
	if (!unread) return null
	const label = `${unread} unread ${unread === 1 ? 'comment' : 'comments'}${mentions ? `, ${mentions} mentioning you` : ''}`
	return (
		<span className={`home-comment-badge${mentions ? ' home-comment-badge--mention' : ''}`} title={label} aria-label={label}>
			{mentions ? '@' : ''}
			{unread}
		</span>
	)
}
