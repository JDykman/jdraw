import { useCallback, useMemo, useState } from 'react'
import {
	DefaultSizeStyle,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiToastsProvider,
	TLUiOverrides,
} from 'tldraw'
import { useSync } from '@tldraw/sync'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
	useOptionalTldrawAgentApp,
} from './agent/TldrawAgentAppProvider'
import { useAuth } from './auth/AuthContext'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

const tools = [TargetShapeTool, TargetAreaTool]
const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		return {
			...tools,
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

function HelperButtons() {
	const app = useOptionalTldrawAgentApp()
	if (!app) return null
	return (
		<TldrawAgentAppContextProvider app={app}>
			<CustomHelperButtons />
		</TldrawAgentAppContextProvider>
	)
}

function Overlays() {
	const app = useOptionalTldrawAgentApp()
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

const components: TLComponents = {
	HelperButtons,
	Overlays,
}

interface AppProps {
	pageId: string
	onBack?(): void
}

function App({ pageId, onBack }: AppProps) {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [sidebarOpen, setSidebarOpen] = useState(true)
	const { user, getToken } = useAuth()

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	// Build WebSocket URI with auth token
	const wsUri = useCallback(async () => {
		const token = getToken()
		const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
		const host = window.location.host
		return `${proto}://${host}/ws/pages/${pageId}${token ? `?token=${encodeURIComponent(token)}` : ''}`
	}, [pageId, getToken])

	const userInfo = useMemo(
		() => ({ id: user?.id ?? 'anonymous', name: user?.username ?? 'Anonymous' }),
		[user]
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

	const store = useSync({ uri: wsUri, userInfo, assets })

	return (
		<TldrawUiToastsProvider>
			<div className={`tldraw-agent-container${sidebarOpen ? ' sidebar-open' : ''}`}>
				<div className="tldraw-canvas">
					<Tldraw store={store} tools={tools} overrides={overrides} components={components}>
						<TldrawAgentAppProvider pageId={pageId} onMount={setApp} onUnmount={handleUnmount} />
					</Tldraw>
				</div>
				<ErrorBoundary fallback={ChatPanelFallback}>
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<ChatPanel
								open={sidebarOpen}
								onToggle={() => setSidebarOpen((o) => !o)}
								onBack={onBack}
							/>
						</TldrawAgentAppContextProvider>
					)}
				</ErrorBoundary>
			</div>
		</TldrawUiToastsProvider>
	)
}

export default App
