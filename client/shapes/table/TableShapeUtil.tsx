import {
	DefaultFontFaces,
	FONT_FAMILIES,
	getDefaultColorTheme,
	getPointerInfo,
	HTMLContainer,
	LABEL_FONT_SIZES,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	STROKE_SIZES,
	SvgExportContext,
	TLDefaultColorTheme,
	TLResizeInfo,
	TLShapeId,
	useDefaultColorTheme,
	useEditor,
	useIsEditing,
	useValue,
} from 'tldraw'
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
	TABLE_DEFAULT_COL_WIDTH,
	TABLE_DEFAULT_ROW_HEIGHT,
	TABLE_MIN_COL_WIDTH,
	TABLE_MIN_ROW_HEIGHT,
	tableShapeMigrations,
	tableShapeProps,
	TLTableShape,
	TLTableShapeProps,
} from '../../../shared/table/tableShapeProps'
import { activeTableCell } from './tableEditing'
import {
	cellAtPoint,
	cumulative,
	deleteCol,
	deleteRow,
	fillCells,
	fitTableTo,
	insertCol,
	insertRow,
	normalizeTable,
	parseDelimited,
	setCell,
	titleHeight,
} from './tableOps'

const CELL_PADDING = 6

export class TableShapeUtil extends ShapeUtil<TLTableShape> {
	static override type = 'table' as const
	static override props = tableShapeProps
	static override migrations = tableShapeMigrations

	override getDefaultProps(): TLTableShapeProps {
		const cols = 3
		const rows = 3
		return {
			w: cols * TABLE_DEFAULT_COL_WIDTH,
			h: rows * TABLE_DEFAULT_ROW_HEIGHT,
			colWidths: Array(cols).fill(TABLE_DEFAULT_COL_WIDTH),
			rowHeights: Array(rows).fill(TABLE_DEFAULT_ROW_HEIGHT),
			cells: Array.from({ length: rows }, () => Array(cols).fill('')),
			headerRow: true,
			title: '',
			showTitle: false,
			color: 'black',
			fill: 'none',
			size: 's',
			font: 'draw',
			textAlign: 'start',
		}
	}

	override canEdit() {
		return true
	}
	override canResize() {
		return true
	}
	override isAspectRatioLocked() {
		return false
	}

	override getGeometry(shape: TLTableShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override getText(shape: TLTableShape) {
		const body = shape.props.cells.map((r) => r.join('\t')).join('\n')
		return shape.props.showTitle && shape.props.title ? `${shape.props.title}\n${body}` : body
	}

	override getFontFaces(shape: TLTableShape) {
		const fam = DefaultFontFaces[`tldraw_${shape.props.font}`]
		return [fam.normal.normal, fam.normal.bold]
	}

	// ---- Invariants -------------------------------------------------------

	override onBeforeCreate(next: TLTableShape) {
		const props = normalizeTable(next.props)
		return props === next.props ? undefined : { ...next, props }
	}

	override onBeforeUpdate(_prev: TLTableShape, next: TLTableShape) {
		const props = normalizeTable(next.props)
		return props === next.props ? undefined : { ...next, props }
	}

	// ---- Box resize: scale columns/rows proportionally --------------------

	override onResize(shape: TLTableShape, info: TLResizeInfo<TLTableShape>) {
		const init = info.initialShape.props
		const next = resizeBox(shape, info, {
			minWidth: init.colWidths.length * TABLE_MIN_COL_WIDTH,
			minHeight: titleHeight(init) + init.rowHeights.length * TABLE_MIN_ROW_HEIGHT,
		})
		return { x: next.x, y: next.y, props: fitTableTo(init, next.props.w, next.props.h) }
	}

	// ---- Editing ----------------------------------------------------------

	override onDoubleClick(shape: TLTableShape) {
		const p = this.editor.getPointInShapeSpace(shape, this.editor.inputs.getCurrentPagePoint())
		const { row, col } = cellAtPoint(shape.props, p.x, p.y)
		activeTableCell.set({ shapeId: shape.id, row, col })
	}

	override onEditStart(shape: TLTableShape) {
		const a = activeTableCell.get()
		if (!a || a.shapeId !== shape.id) activeTableCell.set({ shapeId: shape.id, row: 0, col: 0 })
	}

	override onEditEnd(shape: TLTableShape) {
		if (activeTableCell.get()?.shapeId === shape.id) activeTableCell.set(null)
	}

	// ---- Rendering --------------------------------------------------------

	override component(shape: TLTableShape) {
		return <TableComponent shape={shape} />
	}

	override indicator(shape: TLTableShape) {
		return <rect width={shape.props.w} height={shape.props.h} />
	}

	override toSvg(shape: TLTableShape, ctx: SvgExportContext) {
		const theme = getDefaultColorTheme({ isDarkMode: ctx.isDarkMode })
		const s = getStyle(shape.props, theme)
		const { colWidths, rowHeights, cells, headerRow, w, h, title } = shape.props
		const th = titleHeight(shape.props)
		const cx = cumulative(colWidths)
		const cy = cumulative(rowHeights).map((v) => v + th)
		const align = shape.props.textAlign
		const anchor = align === 'middle' ? 'middle' : align === 'end' ? 'end' : 'start'
		const xFor = (c: number) =>
			align === 'middle' ? cx[c] + colWidths[c] / 2 : align === 'end' ? cx[c + 1] - CELL_PADDING : cx[c] + CELL_PADDING

		return (
			<g>
				{s.bodyBg !== 'transparent' && <rect y={th} width={w} height={h - th} fill={s.bodyBg} />}
				{headerRow && <rect y={th} width={w} height={rowHeights[0]} fill={s.headerBg} />}
				{th > 0 && title && (
					<text
						x={w / 2}
						y={th / 2}
						dominantBaseline="central"
						textAnchor="middle"
						fontFamily={s.exportFontFamily}
						fontSize={s.fontSize}
						fontWeight="bold"
						fill={s.text}
					>
						{title}
					</text>
				)}
				{cells.map((row, r) =>
					row.map((text, c) => {
						if (!text) return null
						const isHeader = headerRow && r === 0
						const x = xFor(c)
						return (
							<text
								key={`${r}-${c}`}
								x={x}
								y={cy[r] + CELL_PADDING + s.fontSize * 0.9}
								fontFamily={s.exportFontFamily}
								fontSize={s.fontSize}
								fontWeight={isHeader ? 'bold' : 'normal'}
								fill={isHeader ? s.headerText : s.text}
								textAnchor={anchor}
							>
								{text.split('\n').map((l, i) => (
									<tspan key={i} x={x} dy={i === 0 ? 0 : s.fontSize * 1.35}>
										{l}
									</tspan>
								))}
							</text>
						)
					})
				)}
				<GridLines w={w} h={h} th={th} cx={cx} cy={cy} stroke={s.stroke} strokeWidth={s.strokeWidth} />
			</g>
		)
	}
}

// ---------------------------------------------------------------------------

function getStyle(props: TLTableShapeProps, theme: TLDefaultColorTheme) {
	const c = theme[props.color]
	const filled = props.fill !== 'none'
	return {
		stroke: c.solid,
		strokeWidth: STROKE_SIZES[props.size],
		fontSize: LABEL_FONT_SIZES[props.size],
		fontFamily: FONT_FAMILIES[props.font],
		/** Font family name tldraw embeds in SVG exports (CSS vars don't resolve there). */
		exportFontFamily: `tldraw_${props.font}`,
		text: theme.text,
		bodyBg: filled ? c.semi : 'transparent',
		headerBg: filled ? c.solid : c.semi,
		headerText: filled ? theme.background : theme.text,
	}
}

let measureCanvas: CanvasRenderingContext2D | null = null
function measureText(text: string, fontFamily: string, fontSize: number, bold: boolean) {
	if (!measureCanvas) measureCanvas = document.createElement('canvas').getContext('2d')
	if (!measureCanvas) return text.length * fontSize * 0.6
	// FONT_FAMILIES are CSS vars; resolve them against the document.
	const resolved = fontFamily.startsWith('var(')
		? getComputedStyle(document.documentElement).getPropertyValue(fontFamily.slice(4, -1)) || 'sans-serif'
		: fontFamily
	measureCanvas.font = `${bold ? 'bold ' : ''}${fontSize}px ${resolved}`
	return measureCanvas.measureText(text).width
}

/** Width of the column to fit its widest content. */
export function autoFitColumn(shape: TLTableShape, col: number): TLTableShapeProps {
	const s = getStyle(shape.props, getDefaultColorTheme({ isDarkMode: false }))
	let widest = 0
	shape.props.cells.forEach((row, r) => {
		const bold = shape.props.headerRow && r === 0
		for (const line of (row[col] ?? '').split('\n')) {
			widest = Math.max(widest, measureText(line, s.fontFamily, s.fontSize, bold))
		}
	})
	const colWidths = [...shape.props.colWidths]
	colWidths[col] = Math.max(TABLE_MIN_COL_WIDTH, Math.ceil(widest + CELL_PADDING * 2 + 2))
	return normalizeTable({ ...shape.props, colWidths })
}

/**
 * Full-length drag strips over every interior divider. Rendered only while the table is the
 * sole selection. Dragging a column divider resizes the column to its left (table grows/shrinks);
 * double-click auto-fits it. Same for rows.
 */
function DividerStrips({ shape }: { shape: TLTableShape }) {
	const editor = useEditor()
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
	const { w, h, colWidths, rowHeights } = shape.props
	const th = titleHeight(shape.props)
	const cx = cumulative(colWidths)
	const cy = cumulative(rowHeights).map((v) => v + th)
	const hit = Math.max(6, 10 / zoom)

	const startDrag = (e: React.PointerEvent, kind: 'col' | 'row', idx: number) => {
		if (e.button !== 0) return
		e.stopPropagation()
		e.preventDefault()
		const el = e.currentTarget as HTMLElement
		el.setPointerCapture(e.pointerId)
		editor.markHistoryStoppingPoint('table divider')
		const onMove = (ev: PointerEvent) => {
			const cur = editor.getShape<TLTableShape>(shape.id)
			if (!cur) return
			const p = editor.getPointInShapeSpace(cur, editor.screenToPage({ x: ev.clientX, y: ev.clientY }))
			if (kind === 'col') {
				const ccx = cumulative(cur.props.colWidths)
				const colWidths = [...cur.props.colWidths]
				colWidths[idx] = Math.max(TABLE_MIN_COL_WIDTH, p.x - ccx[idx])
				editor.updateShape({ id: cur.id, type: 'table', props: normalizeTable({ ...cur.props, colWidths }) })
			} else {
				const ccy = cumulative(cur.props.rowHeights)
				const rowHeights = [...cur.props.rowHeights]
				rowHeights[idx] = Math.max(TABLE_MIN_ROW_HEIGHT, p.y - titleHeight(cur.props) - ccy[idx])
				editor.updateShape({ id: cur.id, type: 'table', props: normalizeTable({ ...cur.props, rowHeights }) })
			}
		}
		const onUp = (ev: PointerEvent) => {
			el.removeEventListener('pointermove', onMove)
			el.removeEventListener('pointerup', onUp)
			el.removeEventListener('pointercancel', onUp)
			try {
				el.releasePointerCapture(ev.pointerId)
			} catch {
				/* already released */
			}
		}
		el.addEventListener('pointermove', onMove)
		el.addEventListener('pointerup', onUp)
		el.addEventListener('pointercancel', onUp)
	}

	const stripBase: React.CSSProperties = { position: 'absolute', pointerEvents: 'all', touchAction: 'none' }

	return (
		<>
			{cx.slice(1, -1).map((x, i) => (
				<div
					key={`c${i}`}
					className="table-divider"
					style={{ ...stripBase, left: x - hit / 2, top: th, width: hit, height: h - th, cursor: 'col-resize' }}
					onPointerDown={(e) => startDrag(e, 'col', i)}
					onDoubleClick={(e) => {
						e.stopPropagation()
						const cur = editor.getShape<TLTableShape>(shape.id)
						if (!cur) return
						editor.markHistoryStoppingPoint('table autofit')
						editor.updateShape({ id: cur.id, type: 'table', props: autoFitColumn(cur, i) })
					}}
				/>
			))}
			{cy.slice(1, -1).map((y, i) => (
				<div
					key={`r${i}`}
					className="table-divider"
					style={{ ...stripBase, left: 0, top: y - hit / 2, width: w, height: hit, cursor: 'row-resize' }}
					onPointerDown={(e) => startDrag(e, 'row', i)}
				/>
			))}
		</>
	)
}

function GridLines({
	w,
	h,
	th,
	cx,
	cy,
	stroke,
	strokeWidth,
}: {
	w: number
	h: number
	th: number
	cx: number[]
	cy: number[]
	stroke: string
	strokeWidth: number
}) {
	return (
		<g stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" fill="none">
			<rect x={0} y={0} width={w} height={h} rx={2} />
			{th > 0 && <line x1={0} y1={th} x2={w} y2={th} />}
			{cx.slice(1, -1).map((x) => (
				<line key={`v${x}`} x1={x} y1={th} x2={x} y2={h} />
			))}
			{cy.slice(1, -1).map((y) => (
				<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} />
			))}
		</g>
	)
}

function TableComponent({ shape }: { shape: TLTableShape }) {
	const theme = useDefaultColorTheme()
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const isSoleSelection = useValue(
		'isSoleSelection',
		() => editor.getOnlySelectedShapeId() === shape.id && editor.getCurrentToolId() === 'select',
		[editor, shape.id]
	)
	const active = useValue(
		'activeTableCell',
		() => {
			const a = activeTableCell.get()
			return a && a.shapeId === shape.id ? a : null
		},
		[shape.id]
	)

	const { w, h, colWidths, rowHeights, cells, headerRow, textAlign, title, showTitle } = shape.props
	const th = titleHeight(shape.props)
	const s = getStyle(shape.props, theme)
	const cx = cumulative(colWidths)
	const cy = cumulative(rowHeights).map((v) => v + th)
	const cssAlign = textAlign === 'middle' ? 'center' : textAlign === 'end' ? 'right' : 'left'

	const cellBase: React.CSSProperties = {
		boxSizing: 'border-box',
		padding: CELL_PADDING,
		fontFamily: s.fontFamily,
		fontSize: s.fontSize,
		lineHeight: 1.35,
		color: s.text,
		textAlign: cssAlign,
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		overflow: 'hidden',
	}

	const titleActive = isEditing && active?.row === -1

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: isEditing ? 'all' : 'none' }}>
			{s.bodyBg !== 'transparent' && (
				<div style={{ position: 'absolute', left: 0, top: th, width: w, height: h - th, background: s.bodyBg }} />
			)}
			{headerRow && (
				<div style={{ position: 'absolute', left: 0, top: th, width: w, height: rowHeights[0], background: s.headerBg }} />
			)}
			{showTitle && (
				<div
					style={{
						position: 'absolute',
						left: 0,
						top: 0,
						width: w,
						height: th,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
					onPointerDown={isEditing ? () => activeTableCell.set({ shapeId: shape.id, row: -1, col: 0 }) : undefined}
				>
					{titleActive ? (
						<CellEditor
							shapeId={shape.id}
							row={-1}
							col={0}
							value={title}
							rowHeight={th}
							style={{ ...cellBase, fontWeight: 'bold', textAlign: 'center', padding: `0 ${CELL_PADDING}px` }}
						/>
					) : (
						<div style={{ ...cellBase, fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap', padding: `0 ${CELL_PADDING}px`, opacity: title ? 1 : 0.4 }}>
							{title || (isEditing ? 'Title' : '')}
						</div>
					)}
				</div>
			)}
			<div
				style={{
					position: 'absolute',
					left: 0,
					top: th,
					width: w,
					height: h - th,
					display: 'grid',
					gridTemplateColumns: colWidths.map((v) => `${v}px`).join(' '),
					gridTemplateRows: rowHeights.map((v) => `${v}px`).join(' '),
				}}
			>
				{cells.map((row, r) =>
					row.map((text, c) => {
						const isHeader = headerRow && r === 0
						const style: React.CSSProperties = {
							...cellBase,
							fontWeight: isHeader ? 'bold' : 'normal',
							color: isHeader ? s.headerText : s.text,
						}
						const isActive = isEditing && active?.row === r && active?.col === c
						if (isActive) {
							return (
								<CellEditor key={`${r}-${c}`} shapeId={shape.id} row={r} col={c} value={text} style={style} rowHeight={rowHeights[r]} />
							)
						}
						return (
							<div
								key={`${r}-${c}`}
								style={style}
								onPointerDown={isEditing ? () => activeTableCell.set({ shapeId: shape.id, row: r, col: c }) : undefined}
							>
								{text}
							</div>
						)
					})
				)}
			</div>
			<svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} width={w} height={h}>
				<GridLines w={w} h={h} th={th} cx={cx} cy={cy} stroke={s.stroke} strokeWidth={s.strokeWidth} />
			</svg>
			{isSoleSelection && <DividerStrips shape={shape} />}
		</HTMLContainer>
	)
}

/**
 * Editor for one cell (row >= 0) or the title (row === -1).
 *
 * Keys: Tab/Shift+Tab move across (Tab on the last cell appends a row); Enter moves down,
 * Shift+Enter newline; Ctrl+Enter / Ctrl+Shift+Enter insert row below/above;
 * Ctrl+Alt+Right/Left insert column right/left; Ctrl+Alt+Backspace delete row;
 * Ctrl+Alt+Shift+Backspace delete column; Esc exits. Pasting tabular text fills a block.
 */
function CellEditor({
	shapeId,
	row,
	col,
	value,
	style,
	rowHeight,
}: {
	shapeId: TLShapeId
	row: number
	col: number
	value: string
	style: React.CSSProperties
	rowHeight: number
}) {
	const editor = useEditor()
	const ref = useRef<HTMLTextAreaElement>(null)
	const isTitle = row === -1

	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		el.focus()
		el.setSelectionRange(el.value.length, el.value.length)
	}, [row, col])

	// Grow the row if content overflows it.
	useEffect(() => {
		if (isTitle) return
		const el = ref.current
		if (!el) return
		const needed = el.scrollHeight
		if (needed > rowHeight + 0.5) {
			const shape = editor.getShape<TLTableShape>(shapeId)
			if (!shape) return
			const rowHeights = [...shape.props.rowHeights]
			rowHeights[row] = needed
			editor.updateShape({ id: shapeId, type: 'table', props: { rowHeights } })
		}
	}, [value, rowHeight, editor, shapeId, row, isTitle])

	const getShape = useCallback(() => editor.getShape<TLTableShape>(shapeId), [editor, shapeId])

	const apply = useCallback(
		(props: TLTableShapeProps, next?: { row: number; col: number }) => {
			editor.markHistoryStoppingPoint('table edit')
			editor.updateShape({ id: shapeId, type: 'table', props })
			if (next) activeTableCell.set({ shapeId, ...next })
		},
		[editor, shapeId]
	)

	const move = useCallback(
		(dr: number, dc: number, extendRows: boolean) => {
			const shape = getShape()
			if (!shape) return
			const rows = shape.props.rowHeights.length
			const cols = shape.props.colWidths.length
			let r = row + dr
			let c = col + dc
			if (c >= cols) {
				c = 0
				r += 1
			}
			if (c < 0) {
				c = cols - 1
				r -= 1
			}
			if (r < 0) {
				if (shape.props.showTitle) activeTableCell.set({ shapeId, row: -1, col: 0 })
				return
			}
			if (r >= rows) {
				if (!extendRows) return
				editor.updateShape({ id: shapeId, type: 'table', props: insertRow(shape.props, rows) })
			}
			activeTableCell.set({ shapeId, row: r, col: c })
		},
		[editor, getShape, shapeId, row, col]
	)

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const shape = getShape()
		if (!shape) return
		const mod = e.ctrlKey || e.metaKey
		const p = shape.props

		if (e.key === 'Escape') {
			e.preventDefault()
			editor.complete()
			return
		}
		if (isTitle) {
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault()
				activeTableCell.set({ shapeId, row: 0, col: 0 })
			}
			return
		}
		if (e.key === 'Tab') {
			e.preventDefault()
			move(0, e.shiftKey ? -1 : 1, !e.shiftKey)
		} else if (e.key === 'Enter' && mod) {
			e.preventDefault()
			const at = e.shiftKey ? row : row + 1
			apply(insertRow(p, at), { row: at, col })
		} else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
			e.preventDefault()
			move(1, 0, false)
		} else if (mod && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
			e.preventDefault()
			const at = e.key === 'ArrowRight' ? col + 1 : col
			apply(insertCol(p, at), { row, col: at })
		} else if (mod && e.altKey && e.key === 'Backspace') {
			e.preventDefault()
			if (e.shiftKey) {
				if (p.colWidths.length <= 1) return
				apply(deleteCol(p, col), { row, col: Math.min(col, p.colWidths.length - 2) })
			} else {
				if (p.rowHeights.length <= 1) return
				apply(deleteRow(p, row), { row: Math.min(row, p.rowHeights.length - 2), col })
			}
		}
	}

	const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		if (isTitle) return
		const text = e.clipboardData.getData('text/plain')
		const grid = parseDelimited(text)
		if (!grid) return // single value: let the textarea handle it
		e.preventDefault()
		const shape = getShape()
		if (!shape) return
		apply(fillCells(shape.props, row, col, grid))
	}

	return (
		<textarea
			ref={ref}
			value={value}
			spellCheck={false}
			style={{
				...style,
				resize: 'none',
				border: 'none',
				outline: 'none',
				background: 'transparent',
				width: '100%',
				height: '100%',
				margin: 0,
				overflow: 'hidden',
				...(isTitle ? { whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' } : null),
			}}
			onPointerDown={(e) => {
				editor.dispatch({
					...getPointerInfo(editor, e),
					type: 'pointer',
					name: 'pointer_down',
					target: 'shape',
					shape: editor.getShape(shapeId)!,
				})
				e.stopPropagation()
			}}
			onChange={(e) => {
				const shape = getShape()
				if (!shape) return
				const v = e.currentTarget.value
				const props = isTitle ? { ...shape.props, title: v.replace(/\n/g, '') } : setCell(shape.props, row, col, v)
				editor.updateShape({ id: shapeId, type: 'table', props })
			}}
			onKeyDown={onKeyDown}
			onPaste={onPaste}
		/>
	)
}
