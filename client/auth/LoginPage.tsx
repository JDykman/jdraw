import { FormEvent, useState } from 'react'
import { useAuth } from './AuthContext'

export function LoginPage() {
	const { login } = useAuth()
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		setError('')
		setLoading(true)
		const form = e.currentTarget
		const username = (form.elements.namedItem('username') as HTMLInputElement).value
		const password = (form.elements.namedItem('password') as HTMLInputElement).value
		try {
			await login(username, password)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Login failed')
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="login-page">
			<div className="login-card">
				<h1>jdraw</h1>
				<form onSubmit={handleSubmit}>
					<input name="username" type="text" placeholder="Username" autoComplete="username" required />
					<input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
					{error && <p className="login-error">{error}</p>}
					<button type="submit" disabled={loading}>
						{loading ? 'Signing in…' : 'Sign in'}
					</button>
				</form>
			</div>
		</div>
	)
}
