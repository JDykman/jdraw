import { atom, Editor, getDefaultUserPresence, TLPresenceUserInfo, TLStore } from 'tldraw'

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '🔥', '🤔', '✅'] as const

export interface Reaction {
	id: string
	emoji: string
	x: number
	y: number
}

/** This tab's latest reaction. Broadcast to others through presence meta. */
export const $myReaction = atom<Reaction | null>('my reaction', null)

let clearTimer: ReturnType<typeof setTimeout> | undefined

// Last pointer position over the canvas itself (tldraw's input point also follows the pointer
// over UI, which would put the reaction on top of the picker button)
let lastCanvasPoint: { x: number; y: number } | null = null

/** Track where the pointer last was over the canvas. Returns a cleanup function. */
export function trackCanvasPointer(editor: Editor) {
	const onMove = (e: PointerEvent) => {
		const target = e.target as Element | null
		if (!target?.closest('.tl-canvas')) return
		lastCanvasPoint = editor.screenToPage({ x: e.clientX, y: e.clientY })
	}
	document.addEventListener('pointermove', onMove, { passive: true })
	return () => document.removeEventListener('pointermove', onMove)
}

/** Send an emoji reaction at the user's last cursor position on the canvas. */
export function sendReaction(editor: Editor, emoji: string) {
	const { x, y } = lastCanvasPoint ?? editor.getViewportPageBounds().center
	$myReaction.set({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, emoji, x, y })
	// Drop it from presence once it's done animating so late joiners don't see stale reactions
	clearTimeout(clearTimer)
	clearTimer = setTimeout(() => $myReaction.set(null), 3000)
}

/** useSync presence: tldraw's defaults plus the current reaction in `meta`. */
export function getPresenceWithReaction(store: TLStore, user: TLPresenceUserInfo) {
	const presence = getDefaultUserPresence(store, user)
	if (!presence) return null
	const reaction = $myReaction.get()
	return { ...presence, meta: reaction ? { reaction: { ...reaction } } : {} }
}

export function readReaction(meta: unknown): Reaction | null {
	const r = (meta as { reaction?: Partial<Reaction> } | undefined)?.reaction
	if (!r || typeof r.id !== 'string' || typeof r.emoji !== 'string') return null
	if (typeof r.x !== 'number' || typeof r.y !== 'number') return null
	return r as Reaction
}
