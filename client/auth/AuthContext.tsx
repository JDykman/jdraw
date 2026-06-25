import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { setTokenGetter } from './tokenStore'

export interface AuthUser {
	id: string
	username: string
	isAdmin: boolean
}

interface AuthState {
	user: AuthUser | null
	accessToken: string | null
	loading: boolean
}

interface AuthContextValue extends AuthState {
	login(username: string, password: string): Promise<void>
	logout(): Promise<void>
	getToken(): string | null
	refreshSession(): Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = useState<AuthState>({ user: null, accessToken: null, loading: true })
	// Keep token in a ref so callbacks always have the latest without re-renders
	const tokenRef = useRef<string | null>(null)
	const refreshInFlightRef = useRef<Promise<string | null> | null>(null)

	const setAuth = useCallback((user: AuthUser | null, accessToken: string | null) => {
		tokenRef.current = accessToken
		setTokenGetter(() => tokenRef.current)
		setState({ user, accessToken, loading: false })
	}, [])

	useEffect(() => {
		let cancelled = false
		fetch('/api/auth/me', { credentials: 'include' })
			.then(async (r) => {
				if (cancelled) return
				if (!r.ok) { setAuth(null, null); return }
				const data = await r.json() as { user: AuthUser; accessToken: string }
				setAuth(data.user, data.accessToken)
			})
			.catch(() => {
				if (!cancelled) setAuth(null, null)
			})
		return () => {
			cancelled = true
		}
	}, [setAuth])

	const refreshSession = useCallback(async () => {
		if (refreshInFlightRef.current) return refreshInFlightRef.current

		const request = (async (): Promise<string | null> => {
			try {
				const r = await fetch('/api/auth/me', { credentials: 'include' })
				if (!r.ok) {
					if (r.status === 401) setAuth(null, null)
					return tokenRef.current
				}
				const data = await r.json() as { user: AuthUser; accessToken: string }
				setAuth(data.user, data.accessToken)
				return data.accessToken
			} catch {
				return tokenRef.current
			}
		})()

		refreshInFlightRef.current = request
		request.finally(() => {
			if (refreshInFlightRef.current === request) refreshInFlightRef.current = null
		})
		return request
	}, [setAuth])

	useEffect(() => {
		if (!state.user) return

		const refresh = () => {
			void refreshSession()
		}
		const refreshWhenVisible = () => {
			if (document.visibilityState === 'visible') refresh()
		}
		const intervalId = window.setInterval(refresh, 10 * 60 * 1000)
		window.addEventListener('online', refresh)
		document.addEventListener('visibilitychange', refreshWhenVisible)
		return () => {
			window.clearInterval(intervalId)
			window.removeEventListener('online', refresh)
			document.removeEventListener('visibilitychange', refreshWhenVisible)
		}
	}, [refreshSession, state.user])

	const login = useCallback(async (username: string, password: string) => {
		const r = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ username, password }),
		})
		if (!r.ok) {
			const data = await r.json() as { error: string }
			throw new Error(data.error ?? 'Login failed')
		}
		const data = await r.json() as { user: AuthUser; accessToken: string }
		setAuth(data.user, data.accessToken)
	}, [])

	const logout = useCallback(async () => {
		await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
		setAuth(null, null)
	}, [setAuth])

	const getToken = useCallback(() => tokenRef.current, [])

	return (
		<AuthContext.Provider value={{ ...state, login, logout, getToken, refreshSession }}>
			{children}
		</AuthContext.Provider>
	)
}

export function useAuth() {
	const ctx = useContext(AuthContext)
	if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
	return ctx
}
