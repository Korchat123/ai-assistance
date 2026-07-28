# Live2D Agentic Assistant

A TypeScript monorepo for a voice-enabled agentic assistant with a Live2D
presentation layer.

The current milestone is an agent-and-tools vertical slice. It includes:

- A React and Vite conversation interface.
- A Fastify WebSocket API.
- A local Ollama provider by default, plus optional OpenAI Agents SDK and
  deterministic providers.
- Local browser microphone input and spoken assistant responses.
- Structured `AssistantTurn` presentation output and conversation history.
- A Level 0 `/read <key>` tool and approval-gated Level 1
  `/set <key> <value>` tool.
- Tool audit, timeout, cancellation, output bounds, and secret redaction.
- Protocol 1.0 runtime validation with Zod.
- Ordered server events, cumulative acknowledgements, bounded replay, command
  deduplication, cancellation, heartbeat enforcement, and reconnect/resume.

The Live2D renderer and optional OpenAI Realtime voice transport are available.
Neither requires proprietary assets or API credentials for the default local
placeholder experience. See [AGENTIC.md](./AGENTIC.md) for the roadmap.

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

## Voice modes

Local voice is the default and works with the existing Ollama provider. Open
the app in Chrome or Edge, allow microphone access, and select **Speak**.
The browser transcribes one utterance, sends the resulting text to Ollama, and
reads the assistant response aloud. Selecting **Speak** while audio is playing
interrupts playback.

This first local mode uses the browser Web Speech APIs, so speech recognition
availability and whether recognition is processed on-device depend on the
browser and operating system. A future faster-whisper/Piper adapter can replace
it behind the voice controller for guaranteed offline audio processing.

Copy `apps/web/.env.example` to `apps/web/.env` to make the local setting
explicit:

```env
VITE_VOICE_PROVIDER=local
```

The text agent and voice transport are independent:

- `AGENT_PROVIDER=ollama` keeps Gemma 3 as the default assistant.
- `AGENT_PROVIDER=openai` plus a server-side `OPENAI_API_KEY` allows future
  testing with an OpenAI or Codex API model.
- OpenAI Realtime voice is a separate optional transport and can be used while
  the text agent remains on Ollama.

To enable Realtime voice, add `OPENAI_API_KEY` to the server `.env`, then set
the web environment:

```env
VITE_VOICE_PROVIDER=openai-realtime
VITE_REALTIME_TOKEN_URL=http://127.0.0.1:8000/realtime/client-secret
```

Restart both development servers after changing environment variables. Select
**Start voice** to establish the WebRTC session and allow microphone access.
The microphone stays live until **End voice** is selected. Speaking while the
assistant responds triggers automatic barge-in; **Interrupt** also cancels an
active response explicitly.

The API mints a short-lived browser credential at
`POST /realtime/client-secret`. The permanent OpenAI key, application tools,
and approval decisions remain server-side. Realtime receives no privileged
tool definitions; use the text interface for tool-backed actions.

Never place an OpenAI key in an environment variable whose name starts with
`VITE_`; Vite variables are included in browser code.

## Live2D avatar

The app uses pinned PixiJS 7 and Cubism 4 adapter versions. It intentionally
does not include Cubism Core or a model. Without an active avatar manifest, the
UI keeps the built-in placeholder and all conversation features remain usable.

Follow [docs/live2d-setup.md](./docs/live2d-setup.md) to install a properly
licensed model and the official Cubism Core file locally. The manifest maps
semantic emotions and gestures onto model-specific expressions, motions, and
parameter IDs, so missing capabilities degrade gracefully.

## Verify

```powershell
corepack pnpm check
```

This runs strict typechecking, linting, protocol and WebSocket integration
tests, and production builds.
