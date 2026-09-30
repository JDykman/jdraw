import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TLUiContextMenuProps,
	useEditor,
} from 'tldraw'
import { getLastContextMenuPagePoint } from '../comments/CommentsOverlay'
import { startCommentAt } from '../comments/CommentTool'
import { DiagramContextMenuItems } from '../diagram/DiagramMenu'
import { TableContextMenuItems } from '../shapes/table/TableContextMenu'

function CommentContextMenuItems() {
	const editor = useEditor()
	return (
		<TldrawUiMenuGroup id="comments">
			<TldrawUiMenuItem
				id="add-comment"
				label="Add comment"
				readonlyOk
				onSelect={() => startCommentAt(editor, getLastContextMenuPagePoint() ?? editor.inputs.getCurrentPagePoint())}
			/>
		</TldrawUiMenuGroup>
	)
}

/** The canvas right-click menu: table ops, comments, diagram import, then tldraw's defaults. */
export function CanvasContextMenu(props: TLUiContextMenuProps) {
	return (
		<DefaultContextMenu {...props}>
			<TableContextMenuItems />
			<CommentContextMenuItems />
			<DiagramContextMenuItems />
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	)
}
