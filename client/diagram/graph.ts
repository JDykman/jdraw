import type { TLGeoShapeGeoStyle } from 'tldraw'

/** Top-to-bottom, bottom-to-top, left-to-right, right-to-left (Mermaid and dagre use the same codes). */
export type Direction = 'TB' | 'BT' | 'LR' | 'RL'

export type NodeShape = TLGeoShapeGeoStyle

interface BaseNode {
	/** Stable id within the graph (e.g. the Mermaid node id or SQL table name) */
	id: string
}

export interface GeoNode extends BaseNode {
	kind: 'geo'
	label: string
	shape: NodeShape
	color?: 'black' | 'blue' | 'green' | 'orange' | 'violet' | 'grey' | 'red' | 'light-blue'
}

/** An entity table: header row + one row per column, drawn with the table shape. */
export interface TableNode extends BaseNode {
	kind: 'table'
	title: string
	header: string[]
	rows: string[][]
}

export type DiagramNode = GeoNode | TableNode

export interface DiagramEdge {
	from: string
	to: string
	label?: string
	dashed?: boolean
	thick?: boolean
	/** Arrowheads, in tldraw terms */
	head?: 'arrow' | 'dot' | 'bar' | 'none'
	tail?: 'arrow' | 'dot' | 'bar' | 'none'
	/** For table nodes: data row index (0-based, excluding the header) the edge attaches to */
	fromRow?: number
	toRow?: number
}

export interface DiagramGraph {
	direction: Direction
	nodes: DiagramNode[]
	edges: DiagramEdge[]
}
