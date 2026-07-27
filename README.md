# Live2D Agentic Assistant

A TypeScript monorepo for a voice-enabled agentic assistant with a Live2D
presentation layer.

The current milestone is an agent-and-tools vertical slice. It includes:

- A React and Vite conversation interface.
- A Fastify WebSocket API.
- A local Ollama provider by default, plus optional OpenAI Agents SDK and
  deterministic providers.
- Structured `AssistantTurn` presentation output and conversation history.
- A Level 0 `/read <key>` tool and approval-gated Level 1
  `/set <key> <value>` tool.
- Tool audit, timeout, cancellation, output bounds, and secret redaction.
- Protocol 1.0 runtime validation with Zod.
- Ordered server events, cumulative acknowledgements, bounded replay, command
  deduplication, cancellation, heartbeat enforcement, and reconnect/resume.

Live2D rendering and realtime voice are scheduled for later phases. See
[AGENTIC.md](./AGENTIC.md) for the roadmap.

The API uses local Ollama by default, with no model API charge. Copy
`.env.example` to `.env` and set `OLLAMA_MODEL` to a model shown by
`ollama list`. Set `AGENT_PROVIDER=openai` and add `OPENAI_API_KEY` only when
you intentionally want the separately billed OpenAI API.

## Requirements

- Node.js 22 or newer.
- Corepack.

## Install

```powershell
corepack pnpm install
```

## Run locally

Confirm Ollama has a model. If `ollama list` is empty, download one:

```powershell
ollama pull gemma3
ollama list
```

The Windows Ollama application normally runs the local API in the background
at `http://127.0.0.1:11434`. Otherwise start it with `ollama serve`.

Start the API:

```powershell
corepack pnpm dev:api
```

In another terminal, start the web application:

```powershell
corepack pnpm dev:web
```

Open `http://127.0.0.1:5173`.

The browser connects to `ws://127.0.0.1:8000/ws` by default. Override it with
`VITE_AGENT_WS_URL` when necessary.

## Verify

```powershell
corepack pnpm check
```

This runs strict typechecking, linting, protocol and WebSocket integration
tests, and production builds.
