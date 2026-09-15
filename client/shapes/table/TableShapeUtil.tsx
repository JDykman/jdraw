import {
	DefaultFontFaces,
	FONT_FAMILIES,
	getDefaultColorTheme,
	getPointerInfo,
	HTMLContainer,
	IndexKey,
	LABEL_FONT_SIZES,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	STROKE_SIZES,
	SvgExportContext,
	TLDefaultColorTheme,
	TLHandle,
	TLHandleDragInfo,
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
import { cellAtPoint, cumulative, fitTableTo, insertRow, normalizeTable, setCell } from './tableOps'

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
		return shape.props.cells.map((r) => r.join('\t')).join('\n')
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
			minHeight: init.rowHeights.length * TABLE_MIN_ROW_HEIGHT,
		})
		return {
			x: next.x,
			y: next.y,
			props: fitTableTo(init, next.props.w, next.props.h),
		}
	}

	// ---- Handles: one per interior column/row boundary -------------------

	override getHandles(shape: TLTableShape): TLHandle[] {
		const { colWidths, rowHeights } = shape.props
		const cx = cumulative(colWidths)
		const cy = cumulative(rowHeights)
		const handles: TLHandle[] = []
		// Column dividers sit at the vertical midpoint of the first row.
		for (let i = 1; i < colWidths.length; i++) {
			handles.push({
				id: `col-${i}`,
				label: `Column ${i} divider`,
				type: 'vertex',
				index: `a${i}` as IndexKey,
				x: cx[i],
				y: rowHeights[0] / 2,
			})
		}
		// Row dividers sit at the horizontal midpoint of the first column.
		for (let i = 1; i < rowHeights.length; i++) {
			handles.push({
				id: `row-${i}`,
				label: `Row ${i} divider`,
				type: 'vertex',
				index: `b${i}` as IndexKey,
				x: colWidths[0] / 2,
				y: cy[i],
			})
		}
		return handles
	}

	override getHandleSnapGeometry() {
		return { outline: null, points: [] }
	}

	override onHandleDrag(shape: TLTableShape, { handle }: TLHandleDragInfo<TLTableShape>) {
		const m = /^(col|row)-(\d+)$/.exec(handle.id)
		if (!m) return
		const idx = Number(m[2]) - 1
		if (m[1] === 'col') {
			const cx = cumulative(shape.props.colWidths)
			const colWidths = [...shape.props.colWidths]
			colWidths[idx] = Math.max(TABLE_MIN_COL_WIDTH, handle.x - cx[idx])
			return { id: shape.id, type: shape.type, props: normalizeTable({ ...shape.props, colWidths }) }
		} else {
			const cy = cumulative(shape.props.rowHeights)
			const rowHeights = [...shape.props.rowHeights]
			rowHeights[idx] = Math.max(TABLE_MIN_ROW_HEIGHT, handle.y - cy[idx])
			return { id: shape.id, type: shape.type, props: normalizeTable({ ...shape.props, rowHeights }) }
		}
	}

	// ---- Editing ----------------------------------------------------------

	override onDoubleClick(shape: TLTableShape) {
		// Record which cell was hit; tldraw then enters editing because canEdit() is true.
		const p = this.editor.getPointInShapeSpace(shape, this.editor.inputs.getCurrentPagePoint())
		const { row, col } = cellAtPoint(shape.props, p.x, p.y)
		activeTableCell.set({ shapeId: shape.id, row, col })
	}

	override onEditStart(shape: TLTableShape) {
		const a = activeTableCell.get()
		if (!a || a.shapeId !== shape.id) {
			activeTableCell.set({ shapeId: shape.id, row: 0, col: 0 })
		}
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
		const { colWidths, rowHeights, cells, headerRow, w, h } = shape.props
		const cx = cumulative(colWidths)
		const cy = cumulative(rowHeights)
		const align = shape.props.textAlign

		return (
			<g>
				{s.bodyBg !== 'transparent' && <rect width={w} height={h} fill={s.bodyBg} />}
				{headerRow && <rect width={w} height={rowHeights[0]} fill={s.headerBg} />}
				{cells.map((row, r) =>
					row.map((text, c) => {
						if (!text) return null
						const isHeader = headerRow && r === 0
						const x =
							align === 'middle'
								? cx[c] + colWidths[c] / 2
								: align === 'end'
									? cx[c + 1] - CELL_PADDING
									: cx[c] + CELL_PADDING
						const anchor = align === 'middle' ? 'middle' : align === 'end' ? 'end' : 'start'
						const lines = text.split('\n')
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
								{lines.map((l, i) => (
									<tspan key={i} x={x} dy={i === 0 ? 0 : s.fontSize * 1.35}>
										{l}
									</tspan>
								))}
							</text>
						)
					})
				)}
				<GridLines w={w} h={h} cx={cx} cy={cy} stroke={s.stroke} strokeWidth={s.strokeWidth} />
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

function GridLines({
	w,
	h,
	cx,
	cy,
	stroke,
	strokeWidth,
}: {
	w: number
	h: number
	cx: number[]
	cy: number[]
	stroke: string
	strokeWidth: number
}) {
	return (
		<g stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" fill="none">
			<rect x={0} y={0} width={w} height={h} rx={2} />
			{cx.slice(1, -1).map((x) => (
				<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} />
			))}
			{cy.slice(1, -1).map((y) => (
				<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} />
			))}
		</g>
	)
}

function TableComponent({ shape }: { shape: TLTableShape }) {
	const editor = useEditor()
	const theme = useDefaultColorTheme()
	const isEditing = useIsEditing(shape.id)
	const active = useValue(
		'activeTableCell',
		() => {
			const a = activeTableCell.get()
			return a && a.shapeId === shape.id ? a : null
		},
		[shape.id]
	)

	const { w, h, colWidths, rowHeights, cells, headerRow, textAlign } = shape.props
	const s = getStyle(shape.props, theme)
	const cx = cumulative(colWidths)
	const cy = cumulative(rowHeights)
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

	return (
		<HTMLContainer
			style={{
				width: w,
				height: h,
				pointerEvents: isEditing ? 'all' : 'none',
				background: s.bodyBg,
			}}
		>
			{headerRow && (
				<div style={{ position: 'absolute', left: 0, top: 0, width: w, height: rowHeights[0], background: s.headerBg }} />
			)}
			<div
				style={{
					position: 'absolute',
					inset: 0,
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
								<CellEditor
									key={`${r}-${c}`}
									shapeId={shape.id}
									row={r}
									col={c}
									value={text}
									style={style}
									rowHeight={rowHeights[r]}
								/>
							)
						}
						return (
							<div
								key={`${r}-${c}`}
								style={style}
								onPointerDown={
									isEditing
										? () => activeTableCell.set({ shapeId: shape.id, row: r, col: c })
										: undefined
								}
							>
								{text}
							</div>
						)
					})
				)}
			</div>
			<svg
				style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
				width={w}
				height={h}
			>
				<GridLines w={w} h={h} cx={cx} cy={cy} stroke={s.stroke} strokeWidth={s.strokeWidth} />
			</svg>
		</HTMLContainer>
	)
}

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

	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		el.focus()
		el.setSelectionRange(el.value.length, el.value.length)
	}, [row, col])

	// Grow the row if content overflows it.
	useEffect(() => {
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
	}, [value, rowHeight, editor, shapeId, row])

	const move = useCallback(
		(dr: number, dc: number, extendRows: boolean) => {
			const shape = editor.getShape<TLTableShape>(shapeId)
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
			if (r < 0) return
			if (r >= rows) {
				if (!extendRows) return
				editor.updateShape({ id: shapeId, type: 'table', props: insertRow(shape.props, rows) })
			}
			activeTableCell.set({ shapeId, row: r, col: c })
		},
		[editor, shapeId, row, col]
	)

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
				const shape = editor.getShape<TLTableShape>(shapeId)
				if (!shape) return
				editor.updateShape({
					id: shapeId,
					type: 'table',
					props: setCell(shape.props, row, col, e.currentTarget.value),
				})
			}}
			onKeyDown={(e) => {
				if (e.key === 'Tab') {
					e.preventDefault()
					move(0, e.shiftKey ? -1 : 1, !e.shiftKey)
				} else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
					e.preventDefault()
					if (e.ctrlKey || e.metaKey) editor.complete()
					else move(1, 0, false)
				} else if (e.key === 'Escape') {
					e.preventDefault()
					editor.complete()
				}
			}}
		/>
	)
}
