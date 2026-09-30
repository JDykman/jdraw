/** Application messages sent through the sync socket with room.sendCustomMessage. */
export interface CommentsChangedMessage {
	type: 'comments-changed'
	pageId: string
}

export type CustomSyncMessage = CommentsChangedMessage

export function isCustomSyncMessage(data: unknown): data is CustomSyncMessage {
	return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'comments-changed'
}
