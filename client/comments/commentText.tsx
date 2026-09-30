import { MentionableUser } from './commentsApi'

const MENTION_PATTERN = /@([^\s@]+)/g

/** Render a comment body as text with known @usernames highlighted. */
export function CommentText({ body, users }: { body: string; users: MentionableUser[] }) {
	const known = new Set(users.map((u) => u.username.toLowerCase()))
	const parts: (string | { name: string })[] = []
	let last = 0
	for (const match of body.matchAll(MENTION_PATTERN)) {
		const name = match[1].replace(/[.,;:!?)]+$/, '')
		if (!known.has(name.toLowerCase())) continue
		const start = match.index!
		if (start > last) parts.push(body.slice(last, start))
		parts.push({ name })
		last = start + 1 + name.length
	}
	if (last < body.length) parts.push(body.slice(last))
	return (
		<span className="comment-text">
			{parts.map((p, i) =>
				typeof p === 'string' ? (
					<span key={i}>{p}</span>
				) : (
					<span key={i} className="comment-mention">
						@{p.name}
					</span>
				)
			)}
		</span>
	)
}
