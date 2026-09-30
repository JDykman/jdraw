import { useEffect, useRef, useState } from 'react'
import { useEditor, usePeerIds, usePresence, useValue } from 'tldraw'
import { $myReaction, Reaction, REACTION_EMOJIS, readReaction, sendReaction, trackCanvasPointer } from './reactions'

const REACTION_MS = 2400

/**
 * Top-centre bar: who's here (click an avatar to follow their view) and emoji reactions.
 * Cursor chat is tldraw's built-in "/" on the canvas.
 */
export function CollabBar() {
	const editor = useEditor()
	const peerIds = usePeerIds()
	const followingId = useValue('following', () => editor.getInstanceState().followingUserId, [editor])
	const [pickerOpen, setPickerOpen] = useState(false)
	const pickerRef = useRef<HTMLDivElement>(null)

	useEffect(() => trackCanvasPointer(editor), [editor])

	useEffect(() => {
		if (!pickerOpen) return
		const close = (e: PointerEvent) => {
			if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
		}
		document.addEventListener('pointerdown', close)
		return () => document.removeEventListener('pointerdown', close)
	}, [pickerOpen])

	return (
		<div className="collab-bar">
			{peerIds.map((id) => (
				<PeerAvatar key={id} userId={id} following={followingId === id} />
			))}
			{followingId && (
				<button className="collab-stop-following" onClick={() => editor.stopFollowingUser()}>
					Stop following
				</button>
			)}
			<div className="collab-react" ref={pickerRef}>
				<button
					className="collab-react-button"
					title="React (appears at your cursor)"
					aria-label="Send a reaction"
					aria-expanded={pickerOpen}
					onClick={() => setPickerOpen((o) => !o)}
				>
					☺︎
				</button>
				{pickerOpen && (
					<div className="collab-react-picker" role="menu">
						{REACTION_EMOJIS.map((emoji) => (
							<button key={emoji} role="menuitem" onClick={() => sendReaction(editor, emoji)}>
								{emoji}
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

function PeerAvatar({ userId, following }: { userId: string; following: boolean }) {
	const editor = useEditor()
	const presence = usePresence(userId)
	if (!presence) return null
	const name = presence.userName || 'Someone'
	return (
		<button
			className={`collab-avatar${following ? ' collab-avatar--following' : ''}`}
			style={{ background: presence.color }}
			title={following ? `Following ${name} — click to stop` : `Follow ${name}`}
			aria-label={following ? `Stop following ${name}` : `Follow ${name}`}
			onClick={() => (following ? editor.stopFollowingUser() : editor.startFollowingUser(userId))}
		>
			{name.slice(0, 1).toUpperCase()}
		</button>
	)
}

interface ShownReaction extends Reaction {
	seenAt: number
}

/** Floating emoji for everyone's reactions, anchored to the canvas point they were sent at. */
export function ReactionsOverlay() {
	const editor = useEditor()
	const [shown, setShown] = useState<ShownReaction[]>([])

	const incoming = useValue(
		'reactions',
		() => {
			const list: Reaction[] = []
			const mine = $myReaction.get()
			if (mine) list.push(mine)
			for (const peer of editor.getCollaboratorsOnCurrentPage()) {
				const r = readReaction(peer.meta)
				if (r) list.push(r)
			}
			return list
		},
		[editor]
	)

	// Timestamp on arrival (not the sender's clock) so clock skew can't hide reactions
	useEffect(() => {
		setShown((current) => {
			const known = new Set(current.map((r) => r.id))
			const fresh = incoming.filter((r) => !known.has(r.id)).map((r) => ({ ...r, seenAt: Date.now() }))
			return fresh.length ? [...current, ...fresh] : current
		})
	}, [incoming])

	useEffect(() => {
		if (shown.length === 0) return
		const t = setTimeout(() => setShown((s) => s.filter((r) => Date.now() - r.seenAt < REACTION_MS)), 500)
		return () => clearTimeout(t)
	}, [shown])

	const camera = useValue('camera', () => editor.getCamera(), [editor])
	void camera

	return (
		<>
			{shown.map((r) => {
				const p = editor.pageToViewport({ x: r.x, y: r.y })
				return (
					<div key={r.id} className="collab-reaction" style={{ left: p.x, top: p.y }} aria-hidden="true">
						{r.emoji}
					</div>
				)
			})}
		</>
	)
}
