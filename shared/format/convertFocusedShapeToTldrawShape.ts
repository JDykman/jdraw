import {
	Box,
	createShapeId,
	Editor,
	FONT_SIZES,
	IndexKey,
	reverseRecordsDiff,
	TLArrowShape,
	TLBindingCreate,
	TLDefaultShape,
	TLDrawShape,
	TLGeoShape,
	TLGeoShapeGeoStyle,
	TLLineShape,
	TLNoteShape,
	TLShape,
	TLShapeId,
	TLTextShape,
	toRichText,
	Vec,
	VecLike,
} from 'tldraw'
import { rowAnchorPoint, tableSnapPoints } from '../table/tableOps'
import {
	TABLE_MIN_COL_WIDTH,
	TABLE_MIN_ROW_HEIGHT,
	TABLE_TITLE_HEIGHT,
	TLTableShape,
	TLTableShapeProps,
} from '../table/tableShapeProps'
import { asColor } from './FocusedColor'
import { convertFocusedFillToTldrawFill } from './FocusedFill'
import { convertFocusedFontSizeToTldrawFontSizeAndScale } from './FocusedFontSize'
import { FocusedGeoShapeType } from './FocusedGeoShapeType'
import {
	FocusedArrowShape,
	FocusedDrawShape,
	FocusedGeoShape,
	FocusedGeoShapePartial,
	FocusedLineShape,
	FocusedNoteShape,
	FocusedShape,
	FocusedShapePartial,
	FocusedTableShape,
	FocusedTextShape,
	FocusedTextShapePartial,
	FocusedUnknownShape,
} from './FocusedShape'

/**
 * Convert a FocusedShape to a shape object to a tldraw shape using defaultShape for fallback values
 * @param editor - The tldraw editor instance
 * @param focusedShape - The focused shape to convert
 * @param defaultShape - The default shape to use for fallback values
 * @returns The converted shape and bindings
 */
export function convertFocusedShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape; bindings?: TLBindingCreate[] } {
	switch (focusedShape._type) {
		case 'text': {
			return convertTextShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'line': {
			return convertLineShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'arrow': {
			return convertArrowShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'cloud':
		case 'rectangle':
		case 'triangle':
		case 'diamond':
		case 'hexagon':
		case 'pill':
		case 'x-box':
		case 'pentagon':
		case 'octagon':
		case 'star':
		case 'parallelogram-right':
		case 'parallelogram-left':
		case 'trapezoid':
		case 'fat-arrow-right':
		case 'fat-arrow-left':
		case 'fat-arrow-up':
		case 'fat-arrow-down':
		case 'check-box':
		case 'heart':
		case 'ellipse': {
			return convertGeoShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'note': {
			return convertNoteShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'draw': {
			return convertDrawShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'table': {
			return convertTableShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
		case 'unknown': {
			return convertUnknownShapeToTldrawShape(editor, focusedShape, { defaultShape })
		}
	}
}

export function convertSimpleIdToTldrawId(id: string): TLShapeId {
	return ('shape:' + id) as TLShapeId
}

export function convertFocusedTypeToTldrawType(
	type: FocusedShape['_type']
): TLGeoShapeGeoStyle | TLDefaultShape['type'] | 'unknown' {
	if (type in FOCUSED_TO_GEO_TYPES) {
		return convertFocusedGeoTypeToTldrawGeoGeoType(
			type as FocusedGeoShapeType
		) as TLGeoShapeGeoStyle
	}
	return type as TLDefaultShape['type'] | 'unknown'
}

export function convertFocusedGeoTypeToTldrawGeoGeoType(
	type: FocusedGeoShapeType
): TLGeoShapeGeoStyle {
	return FOCUSED_TO_GEO_TYPES[type]
}

export const FOCUSED_TO_GEO_TYPES: Record<FocusedGeoShapeType, TLGeoShapeGeoStyle> = {
	rectangle: 'rectangle',
	ellipse: 'ellipse',
	triangle: 'triangle',
	diamond: 'diamond',
	hexagon: 'hexagon',
	pill: 'oval',
	cloud: 'cloud',
	'x-box': 'x-box',
	'check-box': 'check-box',
	heart: 'heart',
	pentagon: 'pentagon',
	octagon: 'octagon',
	star: 'star',
	'parallelogram-right': 'rhombus',
	'parallelogram-left': 'rhombus-2',
	trapezoid: 'trapezoid',
	'fat-arrow-right': 'arrow-right',
	'fat-arrow-left': 'arrow-left',
	'fat-arrow-up': 'arrow-up',
	'fat-arrow-down': 'arrow-down',
} as const

function convertTextShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedTextShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLTextShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)
	const defaultTextShape = defaultShape as TLTextShape

	// Determine the base font size and scale - focusedShape takes priority
	let textSize: keyof typeof FONT_SIZES = 's'
	let scale = 1

	if (focusedShape.fontSize) {
		const { textSize: calculatedTextSize, scale: calculatedScale } =
			convertFocusedFontSizeToTldrawFontSizeAndScale(focusedShape.fontSize)
		textSize = calculatedTextSize
		scale = calculatedScale
	} else if (defaultTextShape.props?.size) {
		textSize = defaultTextShape.props.size
		scale = defaultTextShape.props.scale ?? 1
	}

	// If maxWidth is provided as a number, enable wrapping (autoSize = false)
	// Otherwise (undefined or null), preserve existing autoSize behavior
	// Check for undefined first to distinguish "not provided" from "explicitly null"
	const autoSize =
		focusedShape.maxWidth !== undefined && focusedShape.maxWidth !== null
			? false
			: (defaultTextShape.props?.autoSize ?? true)
	const font = defaultTextShape.props?.font ?? 'draw'

	let richText
	if (focusedShape.text !== undefined) {
		richText = toRichText(focusedShape.text)
	} else if (defaultTextShape.props?.richText) {
		richText = defaultTextShape.props.richText
	} else {
		richText = toRichText('')
	}

	let textAlign: TLTextShape['props']['textAlign'] = defaultTextShape.props?.textAlign ?? 'start'
	switch (focusedShape.anchor) {
		case 'top-left':
		case 'bottom-left':
		case 'center-left':
			textAlign = 'start'
			break
		case 'top-center':
		case 'bottom-center':
		case 'center':
			textAlign = 'middle'
			break
		case 'top-right':
		case 'bottom-right':
		case 'center-right':
			textAlign = 'end'
			break
	}

	const unpositionedShape: TLTextShape = {
		id: shapeId,
		type: 'text',
		typeName: 'shape',
		x: 0,
		y: 0,
		rotation: defaultTextShape.rotation ?? 0,
		index: defaultTextShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
		parentId: defaultTextShape.parentId ?? editor.getCurrentPageId(),
		isLocked: defaultTextShape.isLocked ?? false,
		opacity: defaultTextShape.opacity ?? 1,
		props: {
			size: textSize,
			scale,
			richText,
			color: asColor(focusedShape.color ?? defaultTextShape.props?.color ?? 'black'),
			textAlign,
			autoSize,
			w:
				focusedShape.maxWidth !== undefined && focusedShape.maxWidth !== null
					? focusedShape.maxWidth
					: (defaultTextShape.props?.w ?? 100),
			font,
		},
		meta: {
			note: focusedShape.note ?? defaultTextShape.meta?.note ?? '',
		},
	}

	const unpositionedBounds = getDummyBounds(editor, unpositionedShape)

	const position = new Vec(defaultTextShape.x ?? 0, defaultTextShape.y ?? 0)
	const x = focusedShape.x ?? defaultTextShape.x ?? 0
	const y = focusedShape.y ?? defaultTextShape.y ?? 0
	switch (focusedShape.anchor) {
		case 'top-left': {
			position.x = x
			position.y = y
			break
		}
		case 'top-center': {
			position.x = x - unpositionedBounds.w / 2
			position.y = y
			break
		}
		case 'top-right': {
			position.x = x - unpositionedBounds.w
			position.y = y
			break
		}
		case 'bottom-left': {
			position.x = x
			position.y = y - unpositionedBounds.h
			break
		}
		case 'bottom-center': {
			position.x = x - unpositionedBounds.w / 2
			position.y = y - unpositionedBounds.h
			break
		}
		case 'bottom-right': {
			position.x = x - unpositionedBounds.w
			position.y = y - unpositionedBounds.h
			break
		}
		case 'center-left': {
			position.x = x
			position.y = y - unpositionedBounds.h / 2
			break
		}
		case 'center-right': {
			position.x = x - unpositionedBounds.w
			position.y = y - unpositionedBounds.h / 2
			break
		}
		case 'center': {
			position.x = focusedShape.x - unpositionedBounds.w / 2
			position.y = focusedShape.y - unpositionedBounds.h / 2
			break
		}
	}
	const positionedShape: TLTextShape = {
		...unpositionedShape,
		x: position.x,
		y: position.y,
	}

	return {
		shape: positionedShape,
	}
}

function convertLineShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedLineShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)
	const defaultLineShape = defaultShape as TLLineShape

	const x1 = focusedShape.x1 ?? 0
	const y1 = focusedShape.y1 ?? 0
	const x2 = focusedShape.x2 ?? 0
	const y2 = focusedShape.y2 ?? 0
	const minX = Math.min(x1, x2)
	const minY = Math.min(y1, y2)

	return {
		shape: {
			id: shapeId,
			type: 'line',
			typeName: 'shape',
			x: minX,
			y: minY,
			rotation: defaultLineShape.rotation ?? 0,
			index: defaultLineShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
			parentId: defaultLineShape.parentId ?? editor.getCurrentPageId(),
			isLocked: defaultLineShape.isLocked ?? false,
			opacity: defaultLineShape.opacity ?? 1,
			props: {
				size: defaultLineShape.props?.size ?? 's',
				points: {
					a1: {
						id: 'a1',
						index: 'a1' as IndexKey,
						x: x1 - minX,
						y: y1 - minY,
					},
					a2: {
						id: 'a2',
						index: 'a2' as IndexKey,
						x: x2 - minX,
						y: y2 - minY,
					},
				},
				color: asColor(focusedShape.color ?? defaultLineShape.props?.color ?? 'black'),
				dash: defaultLineShape.props?.dash ?? 'draw',
				scale: defaultLineShape.props?.scale ?? 1,
				spline: defaultLineShape.props?.spline ?? 'line',
			},
			meta: {
				note: focusedShape.note ?? defaultLineShape.meta?.note ?? '',
			},
		},
	}
}

function convertArrowShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedArrowShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape; bindings?: TLBindingCreate[] } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)
	const defaultArrowShape = defaultShape as TLArrowShape

	const x1 = focusedShape.x1 ?? defaultArrowShape.props?.start?.x ?? 0
	const y1 = focusedShape.y1 ?? defaultArrowShape.props?.start?.y ?? 0
	const x2 = focusedShape.x2 ?? defaultArrowShape.props?.end?.x ?? 0
	const y2 = focusedShape.y2 ?? defaultArrowShape.props?.end?.y ?? 0
	const minX = Math.min(x1, x2)
	const minY = Math.min(y1, y2)

	// Handle richText properly - focusedShape takes priority
	let richText
	if (focusedShape.text !== undefined) {
		richText = toRichText(focusedShape.text)
	} else if (defaultArrowShape.props?.richText) {
		richText = defaultArrowShape.props.richText
	} else {
		richText = toRichText('')
	}

	const shape = {
		id: shapeId,
		type: 'arrow' as const,
		typeName: 'shape' as const,
		x: minX,
		y: minY,
		rotation: defaultArrowShape.rotation ?? 0,
		index: defaultArrowShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
		parentId: defaultArrowShape.parentId ?? editor.getCurrentPageId(),
		isLocked: defaultArrowShape.isLocked ?? false,
		opacity: defaultArrowShape.opacity ?? 1,
		props: {
			arrowheadEnd: defaultArrowShape.props?.arrowheadEnd ?? 'arrow',
			arrowheadStart: defaultArrowShape.props?.arrowheadStart ?? 'none',
			bend: (focusedShape.bend ?? (defaultArrowShape.props?.bend ?? 0) * -1) * -1,
			color: asColor(focusedShape.color ?? defaultArrowShape.props?.color ?? 'black'),
			dash: defaultArrowShape.props?.dash ?? 'draw',
			elbowMidPoint: defaultArrowShape.props?.elbowMidPoint ?? 0.5,
			end: { x: x2 - minX, y: y2 - minY },
			fill: defaultArrowShape.props?.fill ?? 'none',
			font: defaultArrowShape.props?.font ?? 'draw',
			kind: defaultArrowShape.props?.kind ?? 'arc',
			labelColor: defaultArrowShape.props?.labelColor ?? 'black',
			labelPosition: defaultArrowShape.props?.labelPosition ?? 0.5,
			richText,
			scale: defaultArrowShape.props?.scale ?? 1,
			size: defaultArrowShape.props?.size ?? 's',
			start: { x: x1 - minX, y: y1 - minY },
		},
		meta: {
			note: focusedShape.note ?? defaultArrowShape.meta?.note ?? '',
		},
	}

	// Handle arrow bindings if fromId or toId are provided
	const bindings: TLBindingCreate[] = []

	if (focusedShape.fromId) {
		const fromId = convertSimpleIdToTldrawId(focusedShape.fromId)
		const startShape = editor.getShape(fromId)
		if (startShape) {
			const targetPoint = { x: x1, y: y1 }
			const finalNormalizedAnchor = calculateArrowBindingAnchor(editor, startShape, targetPoint, {
				row: focusedShape.fromRow,
				otherEnd: { x: x2, y: y2 },
			})
			bindings.push({
				type: 'arrow',
				typeName: 'binding',
				fromId: shapeId,
				toId: startShape.id,
				props: {
					normalizedAnchor: finalNormalizedAnchor,
					isExact: false,
					isPrecise: true,
					terminal: 'start',
				},
				meta: {},
			})
		}
	}

	if (focusedShape.toId) {
		const toId = convertSimpleIdToTldrawId(focusedShape.toId)
		const endShape = editor.getShape(toId)
		if (endShape) {
			const targetPoint = { x: x2, y: y2 }
			const finalNormalizedAnchor = calculateArrowBindingAnchor(editor, endShape, targetPoint, {
				row: focusedShape.toRow,
				otherEnd: { x: x1, y: y1 },
			})
			bindings.push({
				type: 'arrow',
				typeName: 'binding',
				fromId: shapeId,
				toId: endShape.id,
				props: {
					normalizedAnchor: finalNormalizedAnchor,
					isExact: false,
					isPrecise: true,
					terminal: 'end',
				},
				meta: {},
			})
		}
	}

	return {
		shape,
		bindings: bindings.length > 0 ? bindings : undefined,
	}
}

function convertGeoShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedGeoShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)
	const shapeType = convertFocusedGeoTypeToTldrawGeoGeoType(focusedShape._type)
	const defaultGeoShape = defaultShape as TLGeoShape

	// Handle richText properly - focusedShape takes priority
	let richText
	if (focusedShape.text !== undefined) {
		richText = toRichText(focusedShape.text)
	} else if (defaultGeoShape.props?.richText) {
		richText = defaultGeoShape.props.richText
	} else {
		richText = toRichText('')
	}

	// Handle fill properly - focusedShape takes priority
	let fill
	if (focusedShape.fill !== undefined) {
		fill = convertFocusedFillToTldrawFill(focusedShape.fill) ?? 'none'
	} else if (defaultGeoShape.props?.fill) {
		fill = defaultGeoShape.props.fill
	} else {
		fill = convertFocusedFillToTldrawFill('none')
	}

	return {
		shape: {
			id: shapeId,
			type: 'geo',
			typeName: 'shape',
			x: focusedShape.x ?? defaultGeoShape.x ?? 0,
			y: focusedShape.y ?? defaultGeoShape.y ?? 0,
			rotation: defaultGeoShape.rotation ?? 0,
			index: defaultGeoShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
			parentId: defaultGeoShape.parentId ?? editor.getCurrentPageId(),
			isLocked: defaultGeoShape.isLocked ?? false,
			opacity: defaultGeoShape.opacity ?? 1,
			props: {
				align: focusedShape.textAlign ?? defaultGeoShape.props?.align ?? 'middle',
				color: asColor(focusedShape.color ?? defaultGeoShape.props?.color ?? 'black'),
				dash: defaultGeoShape.props?.dash ?? 'draw',
				fill,
				font: defaultGeoShape.props?.font ?? 'draw',
				geo: shapeType,
				growY: focusedShape.h !== undefined ? 0 : (defaultGeoShape.props?.growY ?? 0),
				h: focusedShape.h ?? defaultGeoShape.props?.h ?? 100,
				labelColor: defaultGeoShape.props?.labelColor ?? 'black',
				richText,
				scale: defaultGeoShape.props?.scale ?? 1,
				size: defaultGeoShape.props?.size ?? 's',
				url: defaultGeoShape.props?.url ?? '',
				verticalAlign: defaultGeoShape.props?.verticalAlign ?? 'middle',
				w: focusedShape.w ?? defaultGeoShape.props?.w ?? 100,
			},
			meta: {
				note: focusedShape.note ?? defaultGeoShape.meta?.note ?? '',
			},
		},
	}
}

function convertNoteShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedNoteShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)

	const defaultNoteShape = defaultShape as TLNoteShape

	// Handle richText properly - focusedShape takes priority
	let richText
	if (focusedShape.text !== undefined) {
		richText = toRichText(focusedShape.text)
	} else if (defaultNoteShape.props?.richText) {
		richText = defaultNoteShape.props.richText
	} else {
		richText = toRichText('')
	}

	return {
		shape: {
			id: shapeId,
			type: 'note',
			typeName: 'shape',
			x: focusedShape.x ?? defaultNoteShape.x ?? 0,
			y: focusedShape.y ?? defaultNoteShape.y ?? 0,
			rotation: defaultNoteShape.rotation ?? 0,
			index: defaultNoteShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
			parentId: defaultNoteShape.parentId ?? editor.getCurrentPageId(),
			isLocked: defaultNoteShape.isLocked ?? false,
			opacity: defaultNoteShape.opacity ?? 1,
			props: {
				color: asColor(focusedShape.color ?? defaultNoteShape.props?.color ?? 'black'),
				richText,
				size: defaultNoteShape.props?.size ?? 's',
				align: defaultNoteShape.props?.align ?? 'middle',
				font: defaultNoteShape.props?.font ?? 'draw',
				fontSizeAdjustment: defaultNoteShape.props?.fontSizeAdjustment ?? 0,
				growY: defaultNoteShape.props?.growY ?? 0,
				labelColor: defaultNoteShape.props?.labelColor ?? 'black',
				scale: defaultNoteShape.props?.scale ?? 1,
				url: defaultNoteShape.props?.url ?? '',
				verticalAlign: defaultNoteShape.props?.verticalAlign ?? 'middle',
			},
			meta: {
				note: focusedShape.note ?? defaultNoteShape.meta?.note ?? '',
			},
		},
	}
}

function convertDrawShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedDrawShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)
	const defaultDrawShape = defaultShape as TLDrawShape

	// Handle fill properly - focusedShape takes priority
	let fill
	if (focusedShape.fill !== undefined) {
		fill = convertFocusedFillToTldrawFill(focusedShape.fill)
	} else if (defaultDrawShape.props?.fill) {
		fill = defaultDrawShape.props.fill
	} else {
		fill = convertFocusedFillToTldrawFill('none')
	}

	return {
		shape: {
			id: shapeId,
			type: 'draw',
			typeName: 'shape',
			x: defaultDrawShape.x ?? 0,
			y: defaultDrawShape.y ?? 0,
			rotation: defaultDrawShape.rotation ?? 0,
			index: defaultDrawShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
			parentId: defaultDrawShape.parentId ?? editor.getCurrentPageId(),
			isLocked: defaultDrawShape.isLocked ?? false,
			opacity: defaultDrawShape.opacity ?? 1,
			props: {
				...editor.getShapeUtil('draw').getDefaultProps(),
				color: asColor(focusedShape.color ?? defaultDrawShape.props?.color ?? 'black'),
				fill,
			},
			meta: {
				note: focusedShape.note ?? defaultDrawShape.meta?.note ?? '',
			},
		},
	}
}

function convertUnknownShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedUnknownShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)

	return {
		shape: {
			id: shapeId,
			type: defaultShape.type ?? 'geo',
			typeName: 'shape',
			x: focusedShape.x ?? defaultShape.x ?? 0,
			y: focusedShape.y ?? defaultShape.y ?? 0,
			rotation: defaultShape.rotation ?? 0,
			index: defaultShape.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
			parentId: defaultShape.parentId ?? editor.getCurrentPageId(),
			isLocked: defaultShape.isLocked ?? false,
			opacity: defaultShape.opacity ?? 1,
			props: defaultShape.props ?? ({} as any),
			meta: {
				note: focusedShape.note ?? defaultShape.meta?.note ?? '',
			},
		},
	}
}

/**
 * Helper function to calculate the best normalized anchor point for arrow binding
 * @param editor - The tldraw editor instance
 * @param targetShape - The shape to bind to
 * @param targetPoint - The desired point in page space
 * @returns The normalized anchor point (0-1 range within shape bounds)
 */
function calculateArrowBindingAnchor(
	editor: Editor,
	targetShape: TLShape,
	targetPoint: VecLike,
	opts: { row?: number; otherEnd?: VecLike } = {}
): VecLike {
	if (targetShape.type === 'table') {
		return calculateTableArrowAnchor(editor, targetShape as TLTableShape, targetPoint, opts)
	}
	const targetShapePageBounds = editor.getShapePageBounds(targetShape)
	const targetShapeGeometry = editor.getShapeGeometry(targetShape)

	if (!targetShapePageBounds || !targetShapeGeometry) {
		return { x: 0.5, y: 0.5 } // Fall back to center
	}

	// transforms the target shape's geometry to page space for calculations
	const pageTransform = editor.getShapePageTransform(targetShape)
	const targetShapeGeometryInPageSpace = targetShapeGeometry.transform(pageTransform)

	// Step 1: Find the best anchor point on the shape
	// If the target point is inside the shape, use it; otherwise use the nearest point on the shape
	const anchorPoint = targetShapeGeometryInPageSpace.hitTestPoint(targetPoint, 0, true)
		? targetPoint
		: targetShapeGeometryInPageSpace.nearestPoint(targetPoint)

	// Step 2: Convert anchor point to normalized coordinates (0-1 range within shape bounds)
	const normalizedAnchor = {
		x: (anchorPoint.x - targetShapePageBounds.x) / targetShapePageBounds.w,
		y: (anchorPoint.y - targetShapePageBounds.y) / targetShapePageBounds.h,
	}

	// Step 3: Clamp normalized coordinates to valid range [0, 1]
	const clampedNormalizedAnchor = {
		x: Math.max(0.1, Math.min(0.9, normalizedAnchor.x)),
		y: Math.max(0.1, Math.min(0.9, normalizedAnchor.y)),
	}

	// Step 4: Validate that the clamped anchor point is still within the shape geometry. This is necessary because the above logic sometimes fails for some reason?
	const clampedAnchorInPageSpace = {
		x: targetShapePageBounds.x + clampedNormalizedAnchor.x * targetShapePageBounds.w,
		y: targetShapePageBounds.y + clampedNormalizedAnchor.y * targetShapePageBounds.h,
	}

	const finalNormalizedAnchor = targetShapeGeometryInPageSpace.hitTestPoint(
		clampedAnchorInPageSpace,
		0,
		true
	)
		? clampedNormalizedAnchor
		: { x: 0.5, y: 0.5 } // Fall back to center

	return finalNormalizedAnchor
}

/**
 * Arrows attach to table edges: at a given row (on the side facing the arrow's other end),
 * or otherwise at the row/column snap point nearest the requested point.
 */
function calculateTableArrowAnchor(
	editor: Editor,
	table: TLTableShape,
	targetPoint: VecLike,
	{ row, otherEnd }: { row?: number; otherEnd?: VecLike }
): VecLike {
	const p = table.props
	const toShape = (pt: VecLike) => editor.getPointInShapeSpace(table, pt)
	let anchor: { x: number; y: number }
	if (row !== undefined && Number.isFinite(row)) {
		const facing = otherEnd ? toShape(otherEnd) : toShape(targetPoint)
		anchor = rowAnchorPoint(p, row, facing.x < p.w / 2 ? 'left' : 'right')
	} else {
		const local = toShape(targetPoint)
		anchor = tableSnapPoints(p).reduce((best, pt) =>
			Vec.Dist(pt, local) < Vec.Dist(best, local) ? pt : best
		)
	}
	return { x: anchor.x / p.w, y: anchor.y / p.h }
}

const TABLE_CELL_PADDING = 6

/** Rough content-based column width / row height, used when the agent doesn't give sizes. */
function estimateTableSizes(rows: string[][], fontSize: number, headerRow: boolean) {
	const charW = fontSize * 0.6
	const lineH = fontSize * 1.35
	const cols = rows[0]?.length ?? 1
	const colWidths = Array.from({ length: cols }, (_, c) => {
		let widest = 0
		rows.forEach((r, ri) => {
			for (const line of (r[c] ?? '').split('\n')) {
				widest = Math.max(widest, line.length * charW * (headerRow && ri === 0 ? 1.1 : 1))
			}
		})
		return Math.min(400, Math.max(80, Math.ceil(widest + TABLE_CELL_PADDING * 2 + 4)))
	})
	const rowHeights = rows.map((r) => {
		const lines = Math.max(1, ...r.map((c) => (c ?? '').split('\n').length))
		return Math.max(40, Math.ceil(lines * lineH + TABLE_CELL_PADDING * 2))
	})
	return { colWidths, rowHeights }
}

/**
 * Use `given` if it has exactly n valid sizes. Otherwise keep existing sizes by index (so adding a
 * column doesn't resize the others) and auto-size only the new ones.
 */
function pickSizes(given: number[] | undefined, existing: number[] | undefined, auto: number[], min: number) {
	const n = auto.length
	const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
	if (given && given.length === n && given.every(valid)) return given.map((v) => Math.max(min, v))
	return auto.map((a, i) => Math.max(min, existing && valid(existing[i]) ? existing[i] : a))
}

function convertTableShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedTableShape,
	{ defaultShape }: { defaultShape: Partial<TLShape> }
): { shape: TLShape } {
	const shapeId = convertSimpleIdToTldrawId(focusedShape.shapeId)
	const def = defaultShape as Partial<TLTableShape>
	const base = editor.getShapeUtil<TLTableShape>('table').getDefaultProps()
	// Only treat defaultShape as an existing table when it really is one (not the generic create defaults).
	const existing: Partial<TLTableShapeProps> = def.type === 'table' ? (def.props ?? {}) : {}

	// Rectangular grid, at least 1x1.
	const rawRows = Array.isArray(focusedShape.rows) && focusedShape.rows.length ? focusedShape.rows : [['']]
	const cols = Math.max(1, ...rawRows.map((r) => (Array.isArray(r) ? r.length : 0)))
	const cells = rawRows.map((r) =>
		Array.from({ length: cols }, (_, c) => (Array.isArray(r) && r[c] != null ? String(r[c]) : ''))
	)

	const size = existing.size ?? base.size
	const headerRow = focusedShape.headerRow ?? existing.headerRow ?? base.headerRow
	const auto = estimateTableSizes(cells, LABEL_FONT_SIZE_BY_SIZE[size] ?? 18, headerRow)
	const colWidths = pickSizes(focusedShape.colWidths, existing.colWidths, auto.colWidths, TABLE_MIN_COL_WIDTH)
	const rowHeights = pickSizes(focusedShape.rowHeights, existing.rowHeights, auto.rowHeights, TABLE_MIN_ROW_HEIGHT)

	// Keep row/column ids (and per-column styles) by index so arrows and styling survive a full rewrite.
	const byIndex = <T,>(arr: T[] | undefined, n: number, fill: T) =>
		Array.from({ length: n }, (_, i) => (arr && i < arr.length ? arr[i] : fill))
	const rowIds = (existing.rowIds ?? []).slice(0, cells.length)
	const colIds = (existing.colIds ?? []).slice(0, cols)
	const colAlign = byIndex(existing.colAlign, cols, null)
	const colMono = focusedShape.monoColumns
		? Array.from({ length: cols }, (_, i) => focusedShape.monoColumns!.includes(i))
		: byIndex(existing.colMono, cols, false)

	const title = focusedShape.title !== undefined ? focusedShape.title : (existing.title ?? '')
	const showTitle = focusedShape.title !== undefined ? focusedShape.title.trim() !== '' : (existing.showTitle ?? false)
	const fill =
		focusedShape.fill !== undefined
			? (convertFocusedFillToTldrawFill(focusedShape.fill) ?? 'none')
			: (existing.fill ?? base.fill)

	const w = colWidths.reduce((a, b) => a + b, 0)
	const h = (showTitle ? TABLE_TITLE_HEIGHT : 0) + rowHeights.reduce((a, b) => a + b, 0)

	return {
		shape: {
			id: shapeId,
			type: 'table',
			typeName: 'shape',
			x: focusedShape.x ?? def.x ?? 0,
			y: focusedShape.y ?? def.y ?? 0,
			rotation: def.rotation ?? 0,
			index: def.index ?? editor.getHighestIndexForParent(editor.getCurrentPageId()),
			parentId: def.parentId ?? editor.getCurrentPageId(),
			isLocked: def.isLocked ?? false,
			opacity: def.opacity ?? 1,
			props: {
				...base,
				...existing,
				w,
				h,
				cells,
				colWidths,
				rowHeights,
				rowIds,
				colIds,
				colAlign,
				colMono,
				headerRow,
				title,
				showTitle,
				fill,
				color: asColor(focusedShape.color ?? existing.color ?? base.color),
			},
			meta: {
				note: focusedShape.note ?? def.meta?.note ?? '',
			},
		} as TLShape,
	}
}

const LABEL_FONT_SIZE_BY_SIZE: Record<string, number> = { s: 18, m: 22, l: 26, xl: 32 }

/**
 * Get the bounds of a shape by temporarily creating it in the editor.
 * This is useful when we need to know the bounds before the shape is actually created.
 */
function getDummyBounds(editor: Editor, shape: TLShape): Box {
	const bounds = editor.getShapePageBounds(shape)
	if (bounds) {
		return bounds
	}

	// Create a dummy shape and get the bounds, then reverse the creation of the dummy shape
	let dummyBounds: Box | undefined
	const diff = editor.store.extractingChanges(() => {
		editor.run(
			() => {
				const dummyId = createShapeId()
				editor.createShape({
					...shape,
					id: dummyId,
				})
				dummyBounds = editor.getShapePageBounds(dummyId)
			},
			{ ignoreShapeLock: false, history: 'ignore' }
		)
	})
	const reverseDiff = reverseRecordsDiff(diff)
	editor.store.applyDiff(reverseDiff)

	if (!dummyBounds) {
		throw new Error('Failed to get bounds for shape')
	}
	return dummyBounds
}

/**
 * Convert a partial FocusedShape to a tldraw shape.
 * This is used for streaming shapes that are still being generated.
 *
 * @param editor - The tldraw editor instance
 * @param focusedShape - The partial focused shape to convert
 * @param defaultShape - The default shape to use for fallback values
 * @param complete - Whether the shape is complete
 * @returns The converted shape (or null if essential fields are missing), bindings, and position
 */
export function convertPartialFocusedShapeToTldrawShape(
	editor: Editor,
	focusedShape: FocusedShapePartial,
	{ defaultShape, complete }: { defaultShape: Partial<TLShape>; complete: boolean }
): { shape: TLShape | null; bindings: TLBindingCreate[] | null; position: VecLike | null } {
	// For text shapes, require: x, y, text
	if (focusedShape._type === 'text') {
		const partial = focusedShape as FocusedTextShapePartial
		if (partial.x === undefined || partial.y === undefined || partial.text === undefined) {
			return { shape: null, bindings: null, position: null }
		}
		// Fill in minimal required fields, let converter handle the rest with defaults
		const fullShape: FocusedTextShape = {
			...partial,
			_type: 'text',
			shapeId: partial.shapeId ?? ('streaming-shape' as any),
			note: partial.note ?? '',
			anchor: partial.anchor ?? 'top-left',
			color: partial.color ?? 'black',
			maxWidth: partial.maxWidth ?? null,
		} as FocusedTextShape
		const result = convertTextShapeToTldrawShape(editor, fullShape, { defaultShape })
		return { shape: result.shape, bindings: null, position: { x: partial.x, y: partial.y } }
	}

	// For geo shapes, require: _type, x, y, w, h
	if (focusedShape._type && focusedShape._type in FOCUSED_TO_GEO_TYPES) {
		const partial = focusedShape as FocusedGeoShapePartial
		if (
			partial.x === undefined ||
			partial.y === undefined ||
			partial.w === undefined ||
			partial.h === undefined
		) {
			return { shape: null, bindings: null, position: null }
		}
		// Fill in minimal required fields, let converter handle the rest with defaults
		const fullShape: FocusedGeoShape = {
			...partial,
			_type: focusedShape._type as FocusedGeoShape['_type'],
			shapeId: partial.shapeId ?? ('streaming-shape' as any),
			note: partial.note ?? '',
			color: partial.color ?? 'black',
			textAlign: partial.textAlign || 'middle',
		} as FocusedGeoShape
		const result = convertGeoShapeToTldrawShape(editor, fullShape, { defaultShape })
		return { shape: result.shape, bindings: null, position: { x: partial.x, y: partial.y } }
	}

	// For all other shapes, require complete: true
	if (!complete) {
		return { shape: null, bindings: null, position: null }
	}

	// If complete, use the full converter
	const result = convertFocusedShapeToTldrawShape(editor, focusedShape as FocusedShape, {
		defaultShape,
	})
	const position =
		'x' in focusedShape && 'y' in focusedShape
			? { x: focusedShape.x as number, y: focusedShape.y as number }
			: 'x1' in focusedShape && 'y1' in focusedShape
				? { x: focusedShape.x1 as number, y: focusedShape.y1 as number }
				: null
	return { shape: result.shape, bindings: result.bindings ?? null, position }
}
