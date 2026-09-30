import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

// Object URLs keyed by page id + thumbnail version, shared across renders and remounts
const cache = new Map<string, string>()

/** Thumbnails need the auth header, so they're fetched as blobs rather than plain <img src>. */
export function PageThumbnail({ pageId, version }: { pageId: string; version: number | null }) {
	const { getToken } = useAuth()
	const key = `${pageId}:${version}`
	const [src, setSrc] = useState<string | null>(() => cache.get(key) ?? null)

	useEffect(() => {
		if (version == null) {
			setSrc(null)
			return
		}
		const cached = cache.get(key)
		if (cached) {
			setSrc(cached)
			return
		}
		let cancelled = false
		fetch(`/api/pages/${pageId}/thumbnail?v=${version}`, {
			headers: { Authorization: `Bearer ${getToken()}` },
		})
			.then((r) => (r.ok ? r.blob() : null))
			.then((blob) => {
				if (!blob || cancelled) return
				const url = URL.createObjectURL(blob)
				cache.set(key, url)
				setSrc(url)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [key, pageId, version, getToken])

	if (!src) {
		return (
			<div className="home-thumb home-thumb--empty" aria-hidden="true">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
					<rect x="3" y="3" width="18" height="18" rx="3" />
					<path d="M7 15l3-3 3 3 4-4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</div>
		)
	}
	return <img className="home-thumb" src={src} alt="" draggable={false} />
}
