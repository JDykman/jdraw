import { Editor } from 'tldraw'
import { copyAsMermaid, STICKY_SORT_PROMPT } from '../diagram/DiagramMenu'
import { insertGraph } from '../diagram/insertGraph'
import { getLayoutTargets, layoutShapes } from '../diagram/layout'
import { looksLikeSqlSchema, parseSqlSchema } from '../diagram/sqlSchema'

export interface SlashCommand {
	name: string
	args?: string
	description: string
	/** Runs in the browser without calling the model */
	local?: boolean
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: 'flowchart', args: '<process>', description: 'Draw a flowchart' },
	{ name: 'er', args: '<domain or SQL>', description: 'Draw an ER diagram with tables' },
	{ name: 'arch', args: '<system>', description: 'Draw an architecture diagram' },
	{ name: 'tidy', description: 'Fix overlaps, alignment and spacing' },
	{ name: 'explain', description: 'Explain the diagram in Markdown' },
	{ name: 'sort', description: 'Group sticky notes into themes' },
	{ name: 'layout', args: '[lr]', description: 'Auto-layout boxes and arrows', local: true },
	{ name: 'mermaid', description: 'Copy as Mermaid', local: true },
]

export function matchSlashCommands(input: string): SlashCommand[] {
	const m = /^\/(\w*)$/.exec(input)
	if (!m) return []
	return SLASH_COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase()))
}

export type SlashResult =
	/** Send this to the agent; show `display` in the chat */
	| { kind: 'agent'; message: string; display: string }
	/** Handled locally; show `notice` under the input */
	| { kind: 'local'; notice: string }

function scopeOf(editor: Editor) {
	return editor.getSelectedShapeIds().length > 0 ? 'the selected shapes' : 'the diagram on the canvas'
}

/** Expand `/command args`. Returns null for text that isn't a known command. */
export async function runSlashCommand(editor: Editor, input: string): Promise<SlashResult | null> {
	const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(input.trim())
	if (!m) return null
	const name = m[1].toLowerCase()
	const args = (m[2] ?? '').trim()
	const display = input.trim()
	const scope = scopeOf(editor)

	switch (name) {
		case 'flowchart':
			return {
				kind: 'agent',
				display,
				message: `Draw a clear flowchart of: ${args || `the process described by ${scope}`}. Use rectangles for steps, diamonds for decisions and ovals for start/end, connect them with arrows bound to the shapes (label decision branches), and lay it out top to bottom with even spacing.`,
			}
		case 'er':
			if (looksLikeSqlSchema(args)) {
				const ids = insertGraph(editor, parseSqlSchema(args))
				return { kind: 'local', notice: `Drew ${ids.length} shapes from the SQL` }
			}
			return {
				kind: 'agent',
				display,
				message: `Design and draw an ER diagram for: ${args || scope}. Use one table shape per entity with a title and "Column | Type | Key" columns (mark primary keys "PK" and foreign keys "FK → table.column"), connect each foreign key row to the referenced row with an arrow, and lay the tables out so arrows don't cross where possible.`,
			}
		case 'arch':
			return {
				kind: 'agent',
				display,
				message: `Draw a software architecture diagram of: ${args || scope}. Show clients, services, data stores and external systems as labelled boxes (give data stores their own colour), connect them with labelled arrows for the main request and data flows, and group related parts in frames.`,
			}
		case 'tidy':
			return {
				kind: 'agent',
				display,
				message: `Tidy up ${scope}: fix overlapping shapes and text, align and evenly space related shapes, make sizes consistent, and straighten arrows. Don't change any text and don't delete anything.${args ? ` Also: ${args}` : ''}`,
			}
		case 'explain':
			return {
				kind: 'agent',
				display,
				message: `Explain ${scope} to someone who hasn't seen it, in a single message written in Markdown: a one-paragraph summary, then the main parts and how they connect as bullet points, then any gaps, ambiguities or likely mistakes you notice. Don't change the canvas.${args ? ` Focus on: ${args}` : ''}`,
			}
		case 'sort':
			return { kind: 'agent', display, message: STICKY_SORT_PROMPT(editor.getSelectedShapeIds().length > 0) }
		case 'layout': {
			const direction = /^(lr|right|horizontal)/i.test(args) ? 'LR' : 'TB'
			const targets = getLayoutTargets(editor)
			return layoutShapes(editor, targets, direction)
				? { kind: 'local', notice: `Laid out ${targets.length} shapes ${direction === 'LR' ? 'left to right' : 'top to bottom'}` }
				: { kind: 'local', notice: 'Nothing to lay out: select two or more shapes' }
		}
		case 'mermaid':
			try {
				return (await copyAsMermaid(editor))
					? { kind: 'local', notice: 'Copied as Mermaid' }
					: { kind: 'local', notice: 'No boxes or text to export' }
			} catch {
				return { kind: 'local', notice: 'Couldn’t write to the clipboard' }
			}
		default:
			return null
	}
}
