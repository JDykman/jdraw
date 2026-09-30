import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { looksLikeCompose, parseCompose } from '../compose'
import { looksLikeMermaid, parseMermaid, toMermaid } from '../mermaid'
import { looksLikeSqlSchema, parseSqlSchema } from '../sqlSchema'

describe('mermaid', () => {
	it('detects flowcharts only', () => {
		assert.ok(looksLikeMermaid('graph TD\nA-->B'))
		assert.ok(looksLikeMermaid('%% comment\nflowchart LR\n  A --> B'))
		assert.ok(!looksLikeMermaid('sequenceDiagram\nA->>B: hi'))
		assert.ok(!looksLikeMermaid('a graph of things'))
	})

	it('parses shapes, labels, chains and groups', () => {
		const g = parseMermaid(`flowchart LR
			A[Start] --> B{Is it?}
			B -->|Yes| C((Done))
			B -- No --> D([Retry]) --> A
			C & D -.-> E[("Store")]
			F:::hot ==> G{{Hex}}
			H --- I
			subgraph S [Group]
			end
			style A fill:#f9f`)
		assert.equal(g.direction, 'LR')
		const node = (id: string) => g.nodes.find((n) => n.id === id)!
		assert.deepEqual(
			['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((id) => node(id) && [id, (node(id) as any).shape]),
			[
				['A', 'rectangle'],
				['B', 'diamond'],
				['C', 'ellipse'],
				['D', 'oval'],
				['E', 'rectangle'],
				['F', 'rectangle'],
				['G', 'hexagon'],
				['H', 'rectangle'],
				['I', 'rectangle'],
			]
		)
		assert.equal((node('B') as any).label, 'Is it?')
		assert.equal((node('E') as any).label, 'Store')
		const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)
		assert.equal(edge('B', 'C')?.label, 'Yes')
		assert.equal(edge('B', 'D')?.label, 'No')
		assert.ok(edge('D', 'A'))
		assert.ok(edge('C', 'E')?.dashed && edge('D', 'E')?.dashed)
		assert.ok(edge('F', 'G')?.thick)
		assert.equal(edge('H', 'I')?.head, 'none')
		assert.equal(g.edges.length, 8)
	})

	it('handles compact syntax without spaces', () => {
		const g = parseMermaid('graph TD;A-->B;B-.->C;my-node-->D;E--text-->F')
		assert.deepEqual(
			g.edges.map((e) => `${e.from}>${e.to}`),
			['A>B', 'B>C', 'my-node>D', 'E>F']
		)
		assert.equal(g.edges[3].label, 'text')
		assert.equal(g.direction, 'TB')
	})

	it('rejects other diagram types', () => {
		assert.throws(() => parseMermaid('sequenceDiagram\nA->>B: x'), /Only flowcharts/)
	})

	it('round-trips through export', () => {
		const src = `flowchart LR
			a["Load config"] --> b{"Valid?"}
			b -->|"yes"| c(["Run"])
			b -.->|"no"| d["Exit"]
			c ==> d
			d --- a`
		const once = parseMermaid(src)
		const again = parseMermaid(toMermaid(once))
		assert.deepEqual(again, once)
	})
})

describe('sql schema', () => {
	const ddl = `
		-- users table
		CREATE TABLE IF NOT EXISTS public.users (
			id SERIAL PRIMARY KEY,
			email VARCHAR(255) NOT NULL UNIQUE,
			created_at TIMESTAMP DEFAULT now()
		);
		CREATE TABLE "posts" (
			id bigint NOT NULL,
			author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
			title text,
			price numeric(10, 2),
			PRIMARY KEY (id)
		);
		CREATE TABLE post_tags (
			post_id bigint,
			tag_id bigint,
			CONSTRAINT pk PRIMARY KEY (post_id, tag_id),
			CONSTRAINT fk_post FOREIGN KEY (post_id) REFERENCES posts (id)
		);
		CREATE TABLE tags (id int primary key, name text);
		ALTER TABLE post_tags ADD CONSTRAINT fk_tag FOREIGN KEY (tag_id) REFERENCES tags(id);
	`

	it('detects DDL', () => {
		assert.ok(looksLikeSqlSchema(ddl))
		assert.ok(!looksLikeSqlSchema('select * from users'))
	})

	it('parses tables, columns and keys', () => {
		const g = parseSqlSchema(ddl)
		assert.deepEqual(
			g.nodes.map((n) => n.id),
			['users', 'posts', 'post_tags', 'tags']
		)
		const users = g.nodes[0] as any
		assert.deepEqual(users.header, ['Column', 'Type', 'Key'])
		assert.deepEqual(users.rows, [
			['id', 'serial', 'PK'],
			['email', 'varchar(255)', 'UNIQUE, NOT NULL'],
			['created_at', 'timestamp', ''],
		])
		const posts = g.nodes[1] as any
		assert.deepEqual(posts.rows[0], ['id', 'bigint', 'PK'])
		assert.deepEqual(posts.rows[1], ['author_id', 'integer', 'FK → users.id'])
		assert.deepEqual(posts.rows[3], ['price', 'numeric(10, 2)', ''])
		const pt = g.nodes[2] as any
		assert.deepEqual(pt.rows, [
			['post_id', 'bigint', 'PK, FK → posts.id'],
			['tag_id', 'bigint', 'PK, FK → tags.id'],
		])
	})

	it('links foreign keys row to row', () => {
		const g = parseSqlSchema(ddl)
		assert.deepEqual(
			g.edges.map((e) => [e.from, e.fromRow, e.to, e.toRow]),
			[
				['posts', 1, 'users', 0],
				['post_tags', 0, 'posts', 0],
				['post_tags', 1, 'tags', 0],
			]
		)
	})
})

describe('compose', () => {
	const yml = `
version: "3.9"
services:
  web:
    build: ./web
    ports: ["3000:3000"]
    depends_on: [api]
  api:
    image: node:20-alpine
    ports:
      - "8080:80"
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
  db:
    image: postgres:16
  cache:
    image: redis:7
  proxy:
    image: nginx:latest
    links: ["web:frontend"]
`
	it('detects compose files', () => {
		assert.ok(looksLikeCompose(yml))
		assert.ok(!looksLikeCompose('name: x\nitems:\n  - a'))
	})

	it('builds services and dependencies', () => {
		const g = parseCompose(yml)
		assert.deepEqual(
			g.nodes.map((n) => [n.id, (n as any).label.split('\n')]),
			[
				['web', ['web', 'build: ./web', ':3000']],
				['api', ['api', 'node:20-alpine', ':8080']],
				['db', ['db', 'postgres:16']],
				['cache', ['cache', 'redis:7']],
				['proxy', ['proxy', 'nginx:latest']],
			]
		)
		assert.equal((g.nodes[2] as any).color, 'violet')
		assert.equal((g.nodes[4] as any).shape, 'hexagon')
		assert.deepEqual(
			g.edges.map((e) => `${e.from}>${e.to}`),
			['web>api', 'api>db', 'api>cache', 'proxy>web']
		)
	})
})
