import { FormEvent, useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

interface KeysState {
	openai: string
	anthropic: string
	google: string
}

interface ApiKeysSettingsProps {
	onClose(): void
}

export function ApiKeysSettings({ onClose }: ApiKeysSettingsProps) {
	const { getToken } = useAuth()
	const [current, setCurrent] = useState<KeysState>({ openai: '', anthropic: '', google: '' })
	const [form, setForm] = useState<KeysState>({ openai: '', anthropic: '', google: '' })
	const [saving, setSaving] = useState(false)
	const [saved, setSaved] = useState(false)
	const [error, setError] = useState('')

	const authHeaders = useCallback(
		(): HeadersInit => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }),
		[getToken]
	)

	useEffect(() => {
		fetch('/api/keys', { headers: authHeaders() })
			.then((r) => r.json())
			.then((data: KeysState) => setCurrent(data))
			.catch(() => {})
	}, [authHeaders])

	async function handleSubmit(e: FormEvent) {
		e.preventDefault()
		setSaving(true)
		setError('')
		setSaved(false)
		try {
			const r = await fetch('/api/keys', {
				method: 'PUT',
				headers: authHeaders(),
				body: JSON.stringify(form),
			})
			if (!r.ok) throw new Error('Failed to save keys')
			setSaved(true)
			setForm({ openai: '', anthropic: '', google: '' })
			const updated = await fetch('/api/keys', { headers: authHeaders() }).then((r) => r.json()) as KeysState
			setCurrent(updated)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="settings-overlay" onClick={onClose}>
			<div className="settings-panel" onClick={(e) => e.stopPropagation()}>
				<div className="settings-header">
					<h2>API Keys</h2>
					<button className="settings-close" onClick={onClose}>✕</button>
				</div>
				<p className="settings-description">
					Your keys are encrypted and stored on the server. Leave a field blank to keep the existing key.
				</p>
				<form onSubmit={handleSubmit} className="settings-form">
					<label>
						<span>OpenAI</span>
						{current.openai && <span className="key-current">{current.openai}</span>}
						<input
							type="password"
							placeholder="sk-…"
							value={form.openai}
							onChange={(e) => setForm((f) => ({ ...f, openai: e.target.value }))}
							autoComplete="off"
						/>
					</label>
					<label>
						<span>Anthropic</span>
						{current.anthropic && <span className="key-current">{current.anthropic}</span>}
						<input
							type="password"
							placeholder="sk-ant-…"
							value={form.anthropic}
							onChange={(e) => setForm((f) => ({ ...f, anthropic: e.target.value }))}
							autoComplete="off"
						/>
					</label>
					<label>
						<span>Google</span>
						{current.google && <span className="key-current">{current.google}</span>}
						<input
							type="password"
							placeholder="AIza…"
							value={form.google}
							onChange={(e) => setForm((f) => ({ ...f, google: e.target.value }))}
							autoComplete="off"
						/>
					</label>
					{error && <p className="settings-error">{error}</p>}
					{saved && <p className="settings-success">Keys saved.</p>}
					<button type="submit" disabled={saving}>
						{saving ? 'Saving…' : 'Save'}
					</button>
				</form>
			</div>
		</div>
	)
}
