import { createShapeId, Editor, TLFrameShape, TLNoteShape, toRichText } from 'tldraw'
import { insertGraph } from '../diagram/insertGraph'
import { parseMermaid } from '../diagram/mermaid'
import { parseSqlSchema } from '../diagram/sqlSchema'

export type TemplateId = 'blank' | 'flowchart' | 'er' | 'retro' | 'kanban'

export interface PageTemplate {
	id: TemplateId
	name: string
	description: string
	apply?(editor: Editor): void
}

const FLOWCHART = `flowchart TD
  start([Start]) --> input[/Get input/]
  input --> check{Valid?}
  check -->|yes| process[Process it]
  check -->|no| error[Show error]
  error --> input
  process --> done([Done])`

const ER_SCHEMA = `
CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  created_at timestamptz
);
CREATE TABLE posts (
  id serial PRIMARY KEY,
  author_id int NOT NULL REFERENCES users(id),
  title text NOT NULL,
  body text,
  published_at timestamptz
);
CREATE TABLE comments (
  id serial PRIMARY KEY,
  post_id int NOT NULL REFERENCES posts(id),
  author_id int NOT NULL REFERENCES users(id),
  body text NOT NULL
);`

type NoteColor = TLNoteShape['props']['color']

interface Column {
	title: string
	color: NoteColor
	notes: string[]
}

const NOTE = 200
const GAP = 16
const PAD = 24

/** Side-by-side titled frames, each with a column of sticky notes. */
function buildColumns(editor: Editor, columns: Column[], rows: number) {
	const frameW = NOTE + PAD * 2
	const frameH = rows * NOTE + (rows - 1) * GAP + PAD * 2
	const totalW = columns.length * frameW + (columns.length - 1) * 48
	const center = editor.getViewportPageBounds().center
	const x0 = center.x - totalW / 2
	const y0 = center.y - frameH / 2

	columns.forEach((col, i) => {
		const frameId = createShapeId()
		editor.createShape<TLFrameShape>({
			id: frameId,
			type: 'frame',
			x: x0 + i * (frameW + 48),
			y: y0,
			props: { w: frameW, h: frameH, name: col.title },
		})
		editor.createShapes<TLNoteShape>(
			col.notes.map((text, j) => ({
				type: 'note',
				parentId: frameId,
				x: PAD,
				y: PAD + j * (NOTE + GAP),
				props: { color: col.color, richText: toRichText(text) },
			}))
		)
	})
	editor.zoomToFit({ animation: { duration: 0 } })
}

export const PAGE_TEMPLATES: PageTemplate[] = [
	{ id: 'blank', name: 'Blank', description: 'An empty canvas' },
	{
		id: 'flowchart',
		name: 'Flowchart',
		description: 'Start, decision and end steps to edit',
		apply: (editor) => insertGraph(editor, parseMermaid(FLOWCHART)),
	},
	{
		id: 'er',
		name: 'ER diagram',
		description: 'Users, posts and comments tables with keys',
		apply: (editor) => insertGraph(editor, parseSqlSchema(ER_SCHEMA)),
	},
	{
		id: 'retro',
		name: 'Retro board',
		description: 'Went well, to improve, action items',
		apply: (editor) =>
			buildColumns(
				editor,
				[
					{ title: 'Went well', color: 'light-green', notes: ['Add a note…'] },
					{ title: 'To improve', color: 'orange', notes: ['Add a note…'] },
					{ title: 'Action items', color: 'light-blue', notes: ['Owner: what, by when'] },
				],
				4
			),
	},
	{
		id: 'kanban',
		name: 'Kanban',
		description: 'To do, doing and done columns',
		apply: (editor) =>
			buildColumns(
				editor,
				[
					{ title: 'To do', color: 'yellow', notes: ['First task', 'Second task'] },
					{ title: 'Doing', color: 'light-blue', notes: ['In progress'] },
					{ title: 'Done', color: 'light-green', notes: [] },
				],
				4
			),
	},
]

const pendingKey = (pageId: string) => `jdraw:pendingTemplate:${pageId}`

/** Remember which template a just-created page should start from (applied when the canvas opens). */
export function setPendingTemplate(pageId: string, template: TemplateId) {
	if (template === 'blank') return
	try {
		sessionStorage.setItem(pendingKey(pageId), template)
	} catch {
		// Storage unavailable: the page just starts blank
	}
}

export function getPendingTemplate(pageId: string): PageTemplate | null {
	try {
		const id = sessionStorage.getItem(pendingKey(pageId))
		return PAGE_TEMPLATES.find((t) => t.id === id) ?? null
	} catch {
		return null
	}
}

export function clearPendingTemplate(pageId: string) {
	try {
		sessionStorage.removeItem(pendingKey(pageId))
	} catch {
		// ignore
	}
}
