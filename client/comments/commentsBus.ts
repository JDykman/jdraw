import { CustomSyncMessage, isCustomSyncMessage } from '../../shared/sync/customMessages'

type Listener = (message: CustomSyncMessage) => void
const listeners = new Set<Listener>()

/** useSync's onCustomMessageReceived: fan application messages out to whoever is listening. */
export function handleCustomSyncMessage(data: unknown) {
	if (!isCustomSyncMessage(data)) return
	for (const listener of listeners) listener(data)
}

export function subscribeCustomSyncMessages(listener: Listener): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
