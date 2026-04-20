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
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = useState<AuthState>({ user: null, accessToken: null, loading: true })
	// Keep token in a ref so callbacks always have the latest without re-renders
	const tokenRef = useRef<string | null>(null)

	const setAuth = (user: AuthUser | null, accessToken: string | null) => {
		tokenRef.current = accessToken
		setTokenGetter(() => tokenRef.current)
		setState({ user, accessToken, loading: false })
	}

	useEffect(() => {
		fetch('/api/auth/me', { credentials: 'include' })
			.then(async (r) => {
				if (!r.ok) { setAuth(null, null); return }
				const data = await r.json() as { user: AuthUser; accessToken: string }
				setAuth(data.user, data.accessToken)
			})
			.catch(() => setAuth(null, null))
	}, [])

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
	}, [])

	const getToken = useCallback(() => tokenRef.current, [])

	return (
		<AuthContext.Provider value={{ ...state, login, logout, getToken }}>
			{children}
		</AuthContext.Provider>
	)
}

export function useAuth() {
	const ctx = useContext(AuthContext)
	if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
	return ctx
}
