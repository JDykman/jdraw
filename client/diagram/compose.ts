import { parse } from 'yaml'
import type { DiagramEdge, DiagramGraph, GeoNode } from './graph'

/** docker-compose → architecture diagram: one box per service, arrows for depends_on / links. */

export function looksLikeCompose(text: string): boolean {
	return /^services\s*:\s*$/m.test(text)
}

interface ComposeService {
	image?: string
	build?: string | { context?: string }
	ports?: (string | number | { published?: string | number; target?: number })[]
	depends_on?: string[] | Record<string, unknown>
	links?: string[]
}

const DATA_STORE = /postgres|mysql|mariadb|mongo|redis|valkey|memcached|elasticsearch|opensearch|cassandra|clickhouse|sqlite|minio|rabbitmq|kafka|nats/i
const PROXY = /nginx|traefik|caddy|haproxy|envoy/i

function describe(name: string, svc: ComposeService): { label: string; color?: GeoNode['color']; shape: GeoNode['shape'] } {
	const image = svc.image?.split('@')[0]
	const source = image ?? (typeof svc.build === 'string' ? `build: ${svc.build}` : svc.build ? `build: ${svc.build.context ?? '.'}` : '')
	const ports = (svc.ports ?? [])
		.map((p) => (typeof p === 'object' ? p.published ?? p.target : String(p).split(':').slice(-2, -1)[0] ?? p))
		.filter((p) => p !== undefined && p !== '')
		.slice(0, 3)
		.map((p) => `:${p}`)
		.join(' ')
	const label = [name, source, ports].filter(Boolean).join('\n')
	if (image && DATA_STORE.test(image)) return { label, color: 'violet', shape: 'rectangle' }
	if (image && PROXY.test(image)) return { label, color: 'green', shape: 'hexagon' }
	return { label, color: svc.build ? 'blue' : undefined, shape: 'rectangle' }
}

export function parseCompose(text: string): DiagramGraph {
	const doc = parse(text) as { services?: Record<string, ComposeService | null> } | null
	const services = doc?.services
	if (!services || typeof services !== 'object') throw new Error('No services found')

	const names = Object.keys(services)
	const nodes: GeoNode[] = names.map((name) => ({ kind: 'geo', id: name, ...describe(name, services[name] ?? {}) }))
	const edges: DiagramEdge[] = []
	for (const name of names) {
		const svc = services[name] ?? {}
		const deps = Array.isArray(svc.depends_on) ? svc.depends_on : Object.keys(svc.depends_on ?? {})
		const links = (svc.links ?? []).map((l) => l.split(':')[0])
		for (const dep of new Set([...deps, ...links])) {
			if (services[dep] !== undefined) edges.push({ from: name, to: dep, head: 'arrow' })
		}
	}
	return { direction: 'TB', nodes, edges }
}
