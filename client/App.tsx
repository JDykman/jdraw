import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	DefaultSizeStyle,
	DefaultToolbar,
	DefaultToolbarContent,
	ErrorBoundary,
	getUserPreferences,
	setUserPreferences,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiMenuToolItem,
	TldrawUiToastsProvider,
	TLUiOverrides,
	TLUserPreferences,
	defaultShapeUtils,
	useEditor,
	useTldrawUser,
	useIsToolSelected,
	useTools,
	useValue,
} from 'tldraw'
import { useSync } from '@tldraw/sync'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
	useTldrawAgentAppFromEditor,
} from './agent/TldrawAgentAppProvider'
import { SNAPSHOT_LOAD_FAILED_REASON } from '../shared/sync/closeReasons'
import { useAuth } from './auth/AuthContext'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { CollabBar, ReactionsOverlay } from './collab/CollabBar'
import { CompareDialog } from './history/CompareDialog'
import { Checkpoint, HistoryPanel } from './history/HistoryPanel'
import { getPresenceWithReaction } from './collab/reactions'
import { PageThumbnailSync } from './pages/PageThumbnailSync'
import { TemplateApplier } from './pages/TemplateApplier'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'
import {
	TABLE_ICON_URL,
	TableContextMenu,
	TableShapeTool,
	TableShapeUtil,
	TableToolbar,
	hasTableSelection,
	runTableOp,
	setupTableShape,
} from './shapes/table'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

const tools = [TargetShapeTool, TargetAreaTool, TableShapeTool]
// useSync builds its schema from these utils and does NOT add the defaults itself,
// so the defaults must be included or the schema is missing the built-in shapes.
const shapeUtils = [...defaultShapeUtils, TableShapeUtil]
const assetUrls = { icons: { 'tool-table': TABLE_ICON_URL } }
const overrides: TLUiOverrides = {
	// Delete/Backspace with a table row/column selected deletes that row/column, not the table.
	actions: (editor, actions) => {
		const del = actions['delete']
		return {
			...actions,
			delete: {
				...del,
				onSelect(source) {
					if (hasTableSelection(editor)) runTableOp(editor, 'delete-selected')
					else del.onSelect(source)
				},
			},
		}
	},
	tools: (editor, tools) => {
		return {
			...tools,
			table: {
				id: 'table',
				label: 'Table',
				icon: 'tool-table',
				onSelect() {
					editor.setCurrentTool('table')
				},
			},
			'target-area': {
				id: 'target-area',
				label: 'Pick Area',
				kbd: 'c',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-area')
				},
			},
			'target-shape': {
				id: 'target-shape',
				label: 'Pick Shape',
				kbd: 's',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-shape')
				},
			},
		}
	},
}

function Toolbar() {
	const tools = useTools()
	const isTableSelected = useIsToolSelected(tools['table'])
	return (
		<DefaultToolbar>
			<DefaultToolbarContent />
			<TldrawUiMenuToolItem toolId="table" isSelected={isTableSelected} />
		</DefaultToolbar>
	)
}

function HelperButtons() {
	const app = useTldrawAgentAppFromEditor()
	if (!app) return null
	return (
		<TldrawAgentAppContextProvider app={app}>
			<CustomHelperButtons />
		</TldrawAgentAppContextProvider>
	)
}

function LoadingScreen() {
	return (
		<div className="app-loading">
			<span>Connecting to canvas…</span>
		</div>
	)
}

function Overlays() {
	const app = useTldrawAgentAppFromEditor()
	return (
		<>
			<TldrawOverlays />
			{app && (
				<TldrawAgentAppContextProvider app={app}>
					<AgentViewportBoundsHighlights />
					<AllContextHighlights />
				</TldrawAgentAppContextProvider>
			)}
		</>
	)
}

function CanvasNavButtons({
	onBack,
	onHistory,
	historyOpen,
	editor,
}: {
	onBack?: () => void
	onHistory: () => void
	historyOpen: boolean
	editor: any
}) {
	const isMenuOpen = useValue('isMenuOpen', () => editor.getInstanceState().isMenuOpen, [editor])

	return (
		<div className={`canvas-nav-buttons${isMenuOpen ? ' canvas-nav-buttons--menu-open' : ''}`}>
			{onBack && (
				<button className="back-to-pages-button" onClick={onBack} title="Back to pages">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ display: 'block' }}
					>
						<path d="M19 12H5M12 19l-7-7 7-7" />
					</svg>
					<span>Pages</span>
				</button>
			)}
			<button
				className={`back-to-pages-button${historyOpen ? ' back-to-pages-button--active' : ''}`}
				onClick={onHistory}
				title="Version history"
				aria-pressed={historyOpen}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{ display: 'block' }}
				>
					<circle cx="12" cy="12" r="9" />
					<path d="M12 7v5l3 2" />
				</svg>
				<span>History</span>
			</button>
		</div>
	)
}

/**
 * Shown instead of the canvas when the sync connection is rejected for good. The server closes
 * with a fatal code when a page's stored snapshot can't be loaded (the data is quarantined, not
 * lost), so retrying would be pointless.
 */
function PageLoadError({
	error,
	onBack,
	onOpenHistory,
}: {
	error: Error
	onBack?: () => void
	onOpenHistory?: () => void
}) {
	const reason = (error as { reason?: string }).reason
	const loadFailed = reason === SNAPSHOT_LOAD_FAILED_REASON
	return (
		<div className="page-load-error" role="alert">
			<h2>{loadFailed ? 'This page couldn\u2019t be loaded.' : 'Couldn\u2019t connect to this page.'}</h2>
			<p>
				{loadFailed
					? 'Your data was preserved. The stored version was set aside because it failed to load.'
					: reason ?? error.message}
			</p>
			<div className="page-load-error-actions">
				{onBack && (
					<button className="page-load-error-button" onClick={onBack}>
						Back
					</button>
				)}
				{loadFailed && onOpenHistory && (
					<button className="page-load-error-button page-load-error-button--primary" onClick={onOpenHistory}>
						Open history
					</button>
				)}
			</div>
		</div>
	)
}

interface AppProps {
	pageId: string
	onBack?(): void
	/** Remount the page session, e.g. after restoring a version on the load-error screen. */
	onReload?(): void
}

function App({ pageId, onBack, onReload }: AppProps) {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [historyOpen, setHistoryOpen] = useState(false)
	const closeHistory = useCallback(() => setHistoryOpen(false), [])
	const [compareTarget, setCompareTarget] = useState<Checkpoint | null>(null)
	const closeCompare = useCallback(() => setCompareTarget(null), [])
	const [sidebarOpen, setSidebarOpen] = useState(() => {
		const saved = localStorage.getItem('jdraw:sidebarOpen')
		return saved !== null ? saved === 'true' : true
	})
	const { user, getToken, refreshSession } = useAuth()

	useEffect(() => {
		localStorage.setItem('jdraw:sidebarOpen', String(sidebarOpen))
	}, [sidebarOpen])

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	// Build WebSocket URI with a freshly refreshed access token for reconnect attempts.
	const wsUri = useCallback(async () => {
		const token = (await refreshSession()) ?? getToken()
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
		const host = window.location.host
		const uri = `${proto}://${host}/ws/pages/${pageId}${token ? `?token=${encodeURIComponent(token)}` : ''}`
		return uri
	}, [pageId, getToken, refreshSession])

	const accountId = user?.id ?? 'anonymous'
	const accountName = user?.username ?? 'Anonymous'

	// The editor's own user identity MUST share an id with the presence we publish via
	// useSync: editor.getCollaborators() filters out presences whose userId === editor.user.getId().
	// Without this, tldraw uses a random localStorage id and your own presence (second tab,
	// reconnect echo) shows up as another collaborator.
	const [prefs, setPrefs] = useState<TLUserPreferences>(() => {
		const saved = getUserPreferences()
		return { ...saved, id: accountId, name: accountName }
	})
	useEffect(() => {
		setPrefs((p) =>
			p.id === accountId && p.name === accountName ? p : { ...p, id: accountId, name: accountName }
		)
	}, [accountId, accountName])
	// Stable identity: a new callback here would produce a new TLUser every render, and
	// TldrawEditor recreates the whole Editor whenever the `user` prop changes identity.
	const persistPrefs = useCallback(
		(next: TLUserPreferences) => {
			// Keep identity pinned to the account; persist the rest (color, snap mode, etc.).
			const pinned = { ...next, id: accountId, name: accountName }
			setPrefs(pinned)
			setUserPreferences(pinned)
		},
		[accountId, accountName]
	)
	const tldrawUser = useTldrawUser({ userPreferences: prefs, setUserPreferences: persistPrefs })

	const userInfo = useMemo(
		() => ({ id: accountId, name: accountName, color: prefs.color ?? undefined }),
		[accountId, accountName, prefs.color]
	)

	// Minimal no-upload asset store — images/files stored inline as base64
	const assets = useMemo(
		() => ({
			upload: async (_asset: unknown, file: File) => {
				return new Promise<{ src: string }>((resolve) => {
					const reader = new FileReader()
					reader.onload = () => resolve({ src: reader.result as string })
					reader.readAsDataURL(file)
				})
			},
		}),
		[]
	)

	const store = useSync({ uri: wsUri, userInfo, assets, shapeUtils, getUserPresence: getPresenceWithReaction })

	const components: TLComponents = useMemo(
		() => ({
			HelperButtons,
			Overlays,
			LoadingScreen,
			Toolbar,
			ContextMenu: TableContextMenu,
			TopPanel: CollabBar,
			// The collab bar lists people and handles follow; tldraw's people menu would duplicate it
			SharePanel: null,
			InFrontOfTheCanvas: () => (
				<>
					<TldrawAgentAppProvider pageId={pageId} onMount={setApp} onUnmount={handleUnmount} />
					<TableToolbar />
					<PageThumbnailSync pageId={pageId} />
					<TemplateApplier pageId={pageId} />
					<ReactionsOverlay />
				</>
			),
		}),
		[pageId, handleUnmount]
	)

	if (store.status === 'error') {
		return (
			<div className="page-load-error-screen">
				<PageLoadError error={store.error} onBack={onBack} onOpenHistory={() => setHistoryOpen(true)} />
				{historyOpen && (
					<HistoryPanel
						pageId={pageId}
						onClose={closeHistory}
						onRestored={() => {
							setHistoryOpen(false)
							onReload?.()
						}}
					/>
				)}
			</div>
		)
	}

	return (
		<TldrawUiToastsProvider>
			<div
				className={`tldraw-agent-container${sidebarOpen ? ' sidebar-open' : ''}`}
				style={{ background: '#f0f0f0' }}
			>
				<div className="tldraw-canvas" style={{ background: 'white' }}>
					<ErrorBoundary fallback={(err: any) => <div className="app-loading">Canvas Crash: {err.message}</div>}>
						<Tldraw
							store={store}
							user={tldrawUser}
							onMount={setupTableShape}
							shapeUtils={shapeUtils}
							assetUrls={assetUrls}
							tools={tools}
							overrides={overrides}
							components={components}
							licenseKey="tldraw-2031-04-28/WyJHVWxTbGFYNyIsWyIqLmpkcmF3Lm1iamFrZS5jb20iXSw5LCIyMDMxLTA0LTI4Il0.d0WjSqelMluLq8iDFR2dAYd7Ft39qxDQ4d+135Rskj2FdG+g/E11xsBQ+9vyyO0BwWnBa6FD6YwrGuReBKEVtA"
						/>
					</ErrorBoundary>
					{app && (
						<CanvasNavButtons
							onBack={onBack}
							onHistory={() => setHistoryOpen((o) => !o)}
							historyOpen={historyOpen}
							editor={app.editor}
						/>
					)}
					{historyOpen && (
						<HistoryPanel pageId={pageId} onClose={closeHistory} onCompare={app ? setCompareTarget : undefined} />
					)}
					{compareTarget && app && (
						<CompareDialog pageId={pageId} checkpoint={compareTarget} editor={app.editor} onClose={closeCompare} />
					)}
				</div>
				<ErrorBoundary fallback={ChatPanelFallback}>
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<ChatPanel
								open={sidebarOpen}
								onToggle={() => setSidebarOpen((o) => !o)}
							/>
						</TldrawAgentAppContextProvider>
					)}
				</ErrorBoundary>
			</div>
		</TldrawUiToastsProvider>
	)
}

export default App
