import { BaseBoxShapeTool } from 'tldraw'

export class TableShapeTool extends BaseBoxShapeTool {
	static override id = 'table'
	static override initial = 'idle'
	override shapeType = 'table' as const
}
