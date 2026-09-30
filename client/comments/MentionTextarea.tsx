import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MentionableUser } from './commentsApi'

const MAX_SUGGESTIONS = 6

/** Find an "@prefix" token that ends at the caret. */
function mentionAtCaret(value: string, caret: number): { start: number; query: string } | null {
	const before = value.slice(0, caret)
	const match = before.match(/(^|\s)@([^\s@]*)$/)
	if (!match) return null
	return { start: before.length - match[2].length - 1, query: match[2] }
}

/**
 * Textarea with @mention autocomplete. Suggestions come from every user, with those who can't
 * see the page flagged "no access" (mentioning them won't notify them or grant access).
 */
export function MentionTextarea({
	value,
	onChange,
	onSubmit,
	users,
	placeholder,
	autoFocus,
	disabled,
}: {
	value: string
	onChange(value: string): void
	onSubmit(): void
	users: MentionableUser[]
	placeholder?: string
	autoFocus?: boolean
	disabled?: boolean
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	const [caret, setCaret] = useState(0)
	const [selected, setSelected] = useState(0)
	const [dismissed, setDismissed] = useState<string | null>(null)
	// Caret to apply once React has committed a programmatic value change (mention insertion)
	const pendingCaret = useRef<number | null>(null)

	const mention = useMemo(() => mentionAtCaret(value, caret), [value, caret])
	const suggestions = useMemo(() => {
		if (!mention) return []
		const q = mention.query.toLowerCase()
		return users.filter((u) => u.username.toLowerCase().startsWith(q)).slice(0, MAX_SUGGESTIONS)
	}, [mention, users])
	const open = !!mention && suggestions.length > 0 && dismissed !== `${mention.start}:${mention.query}`

	useEffect(() => setSelected(0), [mention?.query])

	useLayoutEffect(() => {
		if (pendingCaret.current === null || !ref.current) return
		const pos = pendingCaret.current
		pendingCaret.current = null
		ref.current.setSelectionRange(pos, pos)
		ref.current.focus()
		setCaret(pos)
	}, [value])

	const syncCaret = () => setCaret(ref.current?.selectionStart ?? 0)

	const pick = (user: MentionableUser) => {
		if (!mention) return
		const next = `${value.slice(0, mention.start)}@${user.username} ${value.slice(caret)}`
		onChange(next)
		pendingCaret.current = mention.start + user.username.length + 2
	}

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (open) {
			if (e.key === 'ArrowDown') {
				e.preventDefault()
				setSelected((s) => (s + 1) % suggestions.length)
				return
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault()
				setSelected((s) => (s - 1 + suggestions.length) % suggestions.length)
				return
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault()
				pick(suggestions[selected])
				return
			}
			if (e.key === 'Escape') {
				e.preventDefault()
				e.stopPropagation()
				setDismissed(`${mention!.start}:${mention!.query}`)
				return
			}
		}
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			onSubmit()
		}
	}

	return (
		<div className="mention-textarea">
			<textarea
				ref={ref}
				value={value}
				placeholder={placeholder}
				autoFocus={autoFocus}
				disabled={disabled}
				rows={3}
				onChange={(e) => {
					onChange(e.target.value)
					setCaret(e.target.selectionStart ?? 0)
				}}
				onKeyDown={onKeyDown}
				onKeyUp={syncCaret}
				onClick={syncCaret}
			/>
			{open && (
				<ul className="mention-suggestions" role="listbox">
					{suggestions.map((u, i) => (
						<li
							key={u.id}
							role="option"
							aria-selected={i === selected}
							className={`${i === selected ? 'is-selected' : ''}${u.hasAccess ? '' : ' no-access'}`}
							onMouseDown={(e) => {
								e.preventDefault()
								pick(u)
							}}
							onMouseEnter={() => setSelected(i)}
						>
							<span>@{u.username}</span>
							{!u.hasAccess && <span className="mention-no-access">no access</span>}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
