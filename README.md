# jdraw

jdraw is an AI-powered diagramming assistant built on top of [tldraw](https://github.com/tldraw/tldraw), a polished infinite canvas library for React. It lets you describe what you want drawn, and an AI agent creates and edits shapes on the canvas in real time.

## What is tldraw?

[tldraw](https://tldraw.dev) is an open-source infinite canvas library that provides a full-featured drawing and diagramming experience: shapes, arrows, text, freehand drawing, selection, grouping, undo/redo, and more. It handles all the rendering and interaction, so this project can focus on the AI layer on top of it.

## Features

- **Collapsible chat panel** — The AI chat sidebar can be toggled open/closed with a smooth slide animation. The toggle button is attached to the panel edge and moves with it.
- **Theme-aware UI** — The chat panel automatically matches tldraw's light or dark color scheme.
- **Conversational canvas editing** — Describe changes in plain language; the agent creates, updates, moves, and deletes shapes.
- **Context selection** — Use the Pick Shape (`s`) and Pick Area (`c`) tools to tell the agent exactly which shapes or regions to focus on.
- **Canvas linting** — The agent detects potential issues (overlapping text, text overflow, disconnected arrows) and can fix them automatically.
- **Todo list** — The agent tracks its own tasks as it works through multi-step requests.
- **Multi-model support** — Works with Anthropic, Google, and OpenAI models. Anthropic recommended for best results.

## Environment setup

Create a `.dev.vars` file in the root directory:

```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

Get your Anthropic API key from the [Anthropic dashboard](https://console.anthropic.com/settings/keys).

## Local development

```bash
yarn install       # or npm install
yarn dev           # or npm run dev
```

Open `http://localhost:5173/` in your browser.

## Agent capabilities

The agent can perform the following actions on the canvas:

- Create, update, and delete shapes
- Draw freehand pen strokes
- Rotate, resize, align, distribute, stack, and reorder shapes
- Write messages and thinking to the chat panel
- Maintain a todo list across multi-step tasks
- Move its viewport to inspect different areas
- Count shapes matching a given expression
- Schedule follow-up work and self-reviews
- Call external APIs (e.g. country lookup)

The agent receives the following information when deciding what to do:

- Your message
- Your current shape selection
- What is currently visible on screen
- Any additional context you've provided (specific shapes or canvas areas)
- Recent actions you've taken
- A screenshot of the agent's current view
- A simplified representation of all shapes in the viewport
- Clusters of shapes outside the viewport
- The current session's chat history
- Canvas lints flagging potential visual issues

## Use the agent programmatically

```ts
// Inside a component wrapped by TldrawAgentAppProvider
const agent = useAgent()
agent.prompt('Draw a cat')
```

With additional context:

```ts
agent.prompt({
	message: 'Draw a cat in this area',
	bounds: { x: 0, y: 0, w: 300, h: 400 },
})
```

Other methods:

- `agent.cancel()` — Cancel the current task
- `agent.reset()` — Clear chat and memory
- `agent.interrupt(input)` — Send a new prompt immediately, interrupting any current work
- `agent.request(input)` — Send a single request without entering an agentic loop

## Architecture

```
client/   — React components, agent logic, browser-side code
worker/   — Cloudflare Worker for model requests and prompt building
shared/   — Types, schemas, and utilities shared between client and worker
```

## Customize the agent

### What the agent can see

Add or edit **prompt parts** to change what information the agent receives. Parts are defined in `shared/schema/PromptPartDefinitions.ts` and collected in `client/parts/`.

Example — tell the agent the current time:

```ts
// shared/schema/PromptPartDefinitions.ts
export const TimePartDefinition: PromptPartDefinition<TimePart> = {
	type: 'time',
	priority: -100,
	buildContent({ time }: TimePart) {
		return [`The user's current time is: ${time}`]
	},
}
```

Enable it by adding its type to a mode's `parts` array in `client/modes/AgentModeDefinitions.ts`.

### What the agent can do

Add or edit **agent actions** to change what the agent can do. Actions are defined in `shared/schema/AgentActionSchemas.ts` and implemented in `client/actions/`.

Example — let the agent clear the canvas:

```ts
export const ClearActionUtil = registerActionUtil(
	class ClearActionUtil extends AgentActionUtil<ClearAction> {
		static override type = 'clear' as const
		override applyAction(action: Streaming<ClearAction>) {
			if (!action.complete) return
			const shapes = this.editor.getCurrentPageShapes()
			this.editor.deleteShapes(shapes)
		}
	}
)
```

Enable it by adding its type to a mode's `actions` array in `client/modes/AgentModeDefinitions.ts`.

### Mode system

The agent uses a **mode system** to control which parts and actions are active. Modes are defined in `client/modes/AgentModeDefinitions.ts`. The default `working` mode includes all standard capabilities.

Switch modes with `agent.mode.setMode(modeType)`. Implement lifecycle hooks in `client/modes/AgentModeChart.ts`:

- `onEnter(agent, fromMode)`
- `onExit(agent, toMode)`
- `onPromptStart(agent, request)`
- `onPromptEnd(agent, request)`
- `onPromptCancel(agent, request)`

## Shape formats

The agent uses three formats when working with shapes:

- **`BlurryShape`** — Overview format for shapes in the viewport (bounds, id, type, text)
- **`FocusedShape`** — Detailed format for shapes the agent is directly working with (color, fill, alignment, and more). Also the format the model uses when creating shapes.
- **`PeripheralShapeCluster`** — Summary format for groups of shapes outside the viewport

Conversion functions live in `shared/format/`. The `h` value on geo shapes represents the actual rendered height including any text overflow growth (`props.h + props.growY`), so the agent always works with accurate dimensions.

## System prompt

The system prompt is built in `worker/prompt/buildSystemPrompt.ts`. Edit the sections in `worker/prompt/sections/` to modify agent instructions. The action schema is automatically included in the system prompt.

## Change the model

```ts
agent.modelName.setModelName('gemini-2-flash')
```

To add support for a new model, add its definition to `AGENT_MODEL_DEFINITIONS` in `shared/models.ts` and configure its provider in `worker/do/AgentService.ts`.

## Custom shapes

The agent can see, move, resize, and arrange custom shapes automatically. To let it create or edit them:

1. **Via action** — Add an agent action that creates your custom shape. Best for simple creation.
2. **Via schema** — Add your shape to `shared/format/FocusedShape.ts`, implement conversion functions in `convertTldrawShapeToFocusedShape.ts` and `convertFocusedShapeToTldrawShape.ts`.

## License

This project is based on the tldraw agent starter kit, provided under the [tldraw SDK license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md).

You can use the tldraw SDK in commercial or non-commercial projects so long as you preserve the "Made with tldraw" watermark on the canvas. To remove the watermark, purchase a [business license](https://tldraw.dev/pricing).
