import { useEffect, useState } from 'react'
import { getUserPreferences, setUserPreferences } from 'tldraw'

export type ColorScheme = 'light' | 'dark' | 'system'

const NEXT: Record<ColorScheme, ColorScheme> = { light: 'dark', dark: 'system', system: 'light' }

function systemIsDark() {
	return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/**
 * The homepage uses the same colour-scheme preference as the canvas (tldraw's user preferences,
 * light by default), so the two always match. Returns the scheme and a cycle function.
 */
export function useHomeTheme() {
	const [scheme, setScheme] = useState<ColorScheme>(() => getUserPreferences().colorScheme ?? 'light')
	const [systemDark, setSystemDark] = useState(systemIsDark)

	useEffect(() => {
		const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
		if (!mq) return
		const onChange = () => setSystemDark(mq.matches)
		mq.addEventListener('change', onChange)
		return () => mq.removeEventListener('change', onChange)
	}, [])

	const effective = scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme

	useEffect(() => {
		document.documentElement.dataset.homeTheme = effective
		return () => {
			delete document.documentElement.dataset.homeTheme
		}
	}, [effective])

	const cycle = () => {
		const next = NEXT[scheme]
		setScheme(next)
		setUserPreferences({ ...getUserPreferences(), colorScheme: next })
	}

	return { scheme, effective, cycle }
}
