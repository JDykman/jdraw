import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TLUiContextMenuProps,
	useEditor,
	useValue,
} from 'tldraw'
import { copyTableAs, getSelectedTable, runTableOp } from './TableToolbar'

export function TableContextMenu(props: TLUiContextMenuProps) {
	const editor = useEditor()
	const table = useValue('selected table', () => getSelectedTable(editor), [editor])
	return (
		<DefaultContextMenu {...props}>
			{table && (
				<TldrawUiMenuGroup id="table">
					<TldrawUiMenuItem id="table-row-add" label="Insert row" onSelect={() => runTableOp(editor, 'row-add')} />
					<TldrawUiMenuItem id="table-row-del" label="Delete row" onSelect={() => runTableOp(editor, 'row-del')} />
					<TldrawUiMenuItem id="table-col-add" label="Insert column" onSelect={() => runTableOp(editor, 'col-add')} />
					<TldrawUiMenuItem id="table-col-del" label="Delete column" onSelect={() => runTableOp(editor, 'col-del')} />
					<TldrawUiMenuItem
						id="table-header"
						label={table.props.headerRow ? 'Remove header row' : 'Make first row header'}
						onSelect={() => runTableOp(editor, 'header-toggle')}
					/>
					<TldrawUiMenuItem
						id="table-title"
						label={table.props.showTitle ? 'Remove title' : 'Add title'}
						onSelect={() => runTableOp(editor, 'title-toggle')}
					/>
				</TldrawUiMenuGroup>
			)}
			{table && (
				<TldrawUiMenuGroup id="table-export">
					<TldrawUiMenuItem id="table-copy-md" label="Copy as Markdown" onSelect={() => copyTableAs(editor, 'markdown')} />
					<TldrawUiMenuItem id="table-copy-csv" label="Copy as CSV" onSelect={() => copyTableAs(editor, 'csv')} />
				</TldrawUiMenuGroup>
			)}
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	)
}
