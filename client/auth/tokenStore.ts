let _getToken: (() => string | null) = () => null

export function setTokenGetter(fn: () => string | null) {
	_getToken = fn
}

export function getAuthToken(): string | null {
	return _getToken()
}
