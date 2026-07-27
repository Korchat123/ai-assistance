# Live2D Agentic Assistant

A TypeScript monorepo for a voice-enabled agentic assistant with a Live2D
presentation layer.

The current milestone is a reliable text-only vertical slice. It includes:

- A React and Vite conversation interface.
- A Fastify WebSocket API.
- A deterministic streaming fake agent.
- Protocol 1.0 runtime validation with Zod.
- Ordered server events, cumulative acknowledgements, bounded replay, command
  deduplication, cancellation, heartbeat enforcement, and reconnect/resume.

Live2D rendering, OpenAI agent integration, and realtime voice are deliberately
scheduled for later phases. See [AGENTIC.md](./AGENTIC.md) for the roadmap.

## Requirements

- Node.js 22 or newer.
- Corepack.

## Install

```powershell
corepack pnpm install
```

## Run locally

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
