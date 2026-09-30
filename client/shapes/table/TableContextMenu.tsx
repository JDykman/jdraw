import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TLUiContextMenuProps,
	useEditor,
	useValue,
} from 'tldraw'
import { DiagramContextMenuItems } from '../../diagram/DiagramMenu'
import { copySelectedTablesAsSql, getSelectedTables } from './tableSqlExport'
import { copyTableAs, getSelectedTable, runTableOp } from './TableToolbar'

export function TableContextMenu(props: TLUiContextMenuProps) {
	const editor = useEditor()
	const table = useValue('selected table', () => getSelectedTable(editor), [editor])
	// Multi-table selections (e.g. an ER diagram with its arrows) export together as one script.
	const tableCount = useValue('selected table count', () => getSelectedTables(editor).length, [editor])
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
			{tableCount > 0 && (
				<TldrawUiMenuGroup id="table-export">
					{table && (
						<>
							<TldrawUiMenuItem id="table-copy-md" label="Copy as Markdown" onSelect={() => copyTableAs(editor, 'markdown')} />
							<TldrawUiMenuItem id="table-copy-csv" label="Copy as CSV" onSelect={() => copyTableAs(editor, 'csv')} />
						</>
					)}
					<TldrawUiMenuItem
						id="table-copy-sql"
						label={tableCount > 1 ? `Copy ${tableCount} tables as SQL` : 'Copy as SQL'}
						onSelect={() => copySelectedTablesAsSql(editor)}
					/>
				</TldrawUiMenuGroup>
			)}
			<DiagramContextMenuItems />
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	)
}
