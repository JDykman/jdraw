export interface ChatImage {
	id: string
	name: string
	dataUrl: string
}

export const MAX_CHAT_IMAGES = 4
// Claude's recommended long edge; bigger images only cost more tokens
const MAX_EDGE = 1568

/** Read an image file, downscale it, and return a JPEG data URL (keeps agent state small). */
export async function fileToChatImage(file: File): Promise<ChatImage> {
	const bitmap = await createImageBitmap(file)
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
	const w = Math.round(bitmap.width * scale)
	const h = Math.round(bitmap.height * scale)
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	const ctx = canvas.getContext('2d')!
	// JPEG has no alpha: flatten transparent screenshots onto white
	ctx.fillStyle = '#fff'
	ctx.fillRect(0, 0, w, h)
	ctx.drawImage(bitmap, 0, 0, w, h)
	bitmap.close()
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name: file.name || 'pasted image',
		dataUrl: canvas.toDataURL('image/jpeg', 0.85),
	}
}

export function imageFilesFrom(list: FileList | File[] | null | undefined): File[] {
	return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}
