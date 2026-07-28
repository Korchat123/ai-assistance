# Agentic Live2D Assistant — Architecture and Implementation Plan

## 1. Goal

Build a production-oriented, voice-enabled agentic assistant with an interactive
Live2D avatar.

The product will support:

- Text and low-latency voice conversations.
- Streaming assistant text and audio.
- Live2D expressions, gestures, eye focus, and lip synchronization.
- Local-first agent inference through Ollama, with an optional OpenAI API
  provider for Codex and other supported models.
- Typed agent tools with validation, authorization, cancellation, and approval.
- Long-running tasks executed outside the realtime conversation loop.
- Durable conversation history, user-controlled memory, and reconnect/resume.
- Bounded sub-agents for independent specialist work.

## 2. Design principles

1. The agent, voice transport, and avatar renderer are separate systems.
2. The server owns tool execution, authorization, and approval decisions.
3. The model uses native tool calling; executable tool calls are never parsed
   from assistant prose or presentation JSON.
4. Live2D receives semantic presentation cues, never raw model parameter IDs.
5. Every network message is runtime validated and versioned.
6. Consequential actions require approval bound to the exact tool arguments.
7. Proprietary Cubism files and model assets are never fabricated or committed
   without confirmed redistribution rights.
8. Sub-agents are bounded, receive minimum context and permissions, and never
   approve actions or communicate externally on their own.
9. Ollama is the default text-agent provider. OpenAI API access is optional,
   selected explicitly, and never required for the local development path.
10. Text-agent providers and voice transports are configured independently.
    Selecting an OpenAI or Codex text model does not implicitly enable OpenAI
    Realtime voice.

## 3. Technology stack

| Area | Choice |
| --- | --- |
| Language | TypeScript |
| Workspace |  |
| Web | React, Vite, Tailwind CSS |
| Avatar | PixiJS 7 plus a pinned compatible Live2D adapter |
| Voice | OpenAI Realtime API over WebRTC |
| Agent runtime | Provider interface with Ollama by default; optional OpenAI Agents SDK for TypeScript |
| Validation | Zod |
| API | Node.js 22 and Fastify |
| App events | WebSocket |
| Database | PostgreSQL |
| Optional vector search | pgvector |
| Durable jobs | Redis and BullMQ |
| Artifact storage | S3-compatible object storage |
| Tests | Vitest and Playwright |

The Live2D implementation must be hidden behind an adapter boundary. We will
pin an exact tested PixiJS/Live2D dependency matrix before installing it.
Cubism Core and licensed model assets will be installed manually and documented
with placeholders in the repository.

### Agent provider strategy

The application supports interchangeable text-agent providers behind one
`AgentProvider` interface:

- `AGENT_PROVIDER=ollama` is the default. It runs locally and requires no
  OpenAI API key.
- `AGENT_PROVIDER=openai` enables the OpenAI Agents SDK and requires a
  server-side `OPENAI_API_KEY`.
- `OPENAI_MODEL` selects the OpenAI API model. Codex models such as
  `gpt-5-codex` are supported through the Responses API path used by the Agents
  SDK. Model availability still depends on the configured OpenAI project.

Provider selection must not change the shared `AssistantTurn`, tool-policy, or
event-protocol contracts. API keys stay on the server and must never use a
`VITE_` environment-variable prefix.

Voice is a separate choice. Local browser speech may be used with either text
provider. OpenAI Realtime voice requires its own server-mediated session flow
and is enabled independently from `AGENT_PROVIDER`.

## 4. System architecture

```text
Browser
├── React interface
├── Live2D renderer
├── Avatar controller
├── Audio and lip-sync engine
├── WebRTC voice session
└── WebSocket application-event client
        │
        ▼
API server
├── Authentication
├── Realtime ephemeral-token endpoint
├── Conversation manager
├── Tool policy and approvals
├── Event persistence
└── Task dispatcher
        │
        ▼
Worker
├── Long-running tasks
├── Tool execution
├── Bounded sub-agents
└── Artifact generation
```

Voice conversation and durable work are separate:

- The conversation manager handles turn-taking, short responses, interruptions,
  and lightweight tools.
- The task orchestrator handles multi-step, code, browser, file, or delayed
  work and reports status through application events.
- Avatar and audio state are projections of agent state, not sources of truth.

## 5. Repository structure

```text
live2d-agent/
├── apps/
│   ├── web/
│   │   ├── public/live2d/
│   │   └── src/
│   │       ├── app/
│   │       ├── features/
│   │       │   ├── avatar/
│   │       │   ├── conversation/
│   │       │   └── voice/
│   │       ├── stores/
│   │       └── transports/
│   ├── api/
│   │   └── src/
│   │       ├── auth/
│   │       ├── config/
│   │       ├── http/
│   │       └── realtime/
│   └── worker/
│       └── src/
│           ├── jobs/
│           └── workflows/
├── packages/
│   ├── agent/
│   │   └── src/
│   │       ├── manager/
│   │       ├── policies/
│   │       ├── prompts/
│   │       ├── runtime/
│   │       └── subagents/
│   ├── avatar-contract/
│   ├── database/
│   ├── memory/
│   ├── observability/
│   ├── protocol/
│   ├── test-utils/
│   └── tools/
├── tests/
│   ├── contract/
│   ├── e2e/
│   └── integration/
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── threat-model.md
│   └── tool-policy.md
├── package.json
└── pnpm-workspace.yaml
```

## 6. Versioned event protocol

All messages use a shared envelope:

```ts
type EventEnvelope<TType extends string, TPayload> = {
  protocolVersion: "1.0";
  type: TType;
  eventId: string;
  sessionId: string;
  conversationId: string;
  turnId?: string;
  runId?: string;
  sequence: number;
  timestamp: string;
  payload: TPayload;
};
```

Initial client events:

- `session.start`
- `session.resume`
- `user.text`
- `task.cancel`
- `approval.resolve`
- `client.capabilities`
- `client.ping`

Initial server events:

- `session.ready`
- `turn.started`
- `assistant.text.delta`
- `assistant.text.completed`
- `agent.state.changed`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `approval.required`
- `avatar.cue`
- `turn.completed`
- `server.error`
- `server.pong`

Example semantic avatar cue:

```json
{
  "protocolVersion": "1.0",
  "type": "avatar.cue",
  "eventId": "evt_123",
  "sessionId": "ses_123",
  "conversationId": "con_123",
  "turnId": "turn_123",
  "sequence": 12,
  "timestamp": "2026-07-27T12:00:00.000Z",
  "payload": {
    "emotion": "happy",
    "intensity": 0.7,
    "gesture": "nod",
    "durationMs": 1200
  }
}
```

The client maps these semantic values through a model capability manifest:

```ts
type AvatarManifest = {
  modelUrl: string;
  parameters: {
    mouthOpen?: string;
    eyeX?: string;
    eyeY?: string;
  };
  expressions: Record<string, string>;
  motions: Record<string, Array<{ group: string; index: number }>>;
};
```

## 7. Agent and tool policy

### Agent output

The final assistant result contains presentation data only:

```ts
type AssistantTurn = {
  displayText: string;
  speechText: string;
  affect: {
    emotion:
      | "neutral"
      | "happy"
      | "sad"
      | "angry"
      | "surprised"
      | "thinking";
    intensity: number;
  };
  gesture?: "idle" | "nod" | "wave" | "explain" | "shrug";
  followUp?: string;
};
```

Tool calls and tool lifecycle events are produced by the runtime separately.
Spoken text must not contain raw URLs, code, secrets, or large tool results.

### Tool risk levels

| Level | Description | Default behavior |
| --- | --- | --- |
| 0 | Scoped, read-only | May auto-run |
| 1 | Reversible local write | Approval by policy |
| 2 | External message or account change | Always approve |
| 3 | Destructive, financial, or privileged | Always approve and revalidate |

Every tool has:

- A Zod input schema.
- Capability and risk metadata.
- User and resource authorization checks.
- Timeouts, cancellation, quotas, and output-size limits.
- Secret redaction and audit events.
- An idempotency strategy for writes.

Approvals are bound to the exact user, tool name, normalized arguments, and
affected resource. Changed arguments require a new approval.

## 8. State models

Conversation state:

```text
disconnected → connecting → listening → user_speaking
→ thinking → assistant_speaking → listening
```

Interruption returns `assistant_speaking` to `listening`. Reconnecting and error
are tracked independently.

Task state:

```text
none | queued | running | waiting_approval | waiting_external
| succeeded | failed | cancelled
```

Tool state:

```text
proposed → validating → awaiting_approval? → running
→ succeeded | failed | cancelled | timed_out
```

## 9. Sub-agent policy

The MVP uses one manager. Initial optional specialists are:

- Research agent: read-only research with source evidence.
- Code-analysis agent: repository inspection and patch recommendations.
- Planning agent: task decomposition without execution authority.
- Memory-candidate agent: proposes memories but cannot persist them.

Constraints:

- Manager owns user dialogue and final synthesis.
- Maximum delegation depth is 1 initially.
- Sub-agents receive minimum context, tools, and secrets.
- Parallel work is limited to independent read-only tasks.
- Writes are serialized by the manager.
- Sub-agents cannot approve actions.
- Every run has limits for agents, tool calls, tokens, retries, and time.
- Results include evidence, uncertainty, artifacts, and recommended actions.

## 10. Memory and persistence

Initial durable entities:

- `users`
- `assistants`
- `conversations`
- `sessions`
- `turns`
- `messages`
- `runs`
- `run_events`
- `tool_calls`
- `approvals`
- `tasks`
- `artifacts`
- `memory_items`
- `memory_sources`
- `prompt_versions`
- `model_configs`

High-frequency avatar values and raw voice audio are not stored by default.
Long-term memories require provenance, confidence, scope, expiry, and user
view/edit/delete controls. Conversation summaries are derived caches rather
than authoritative records.

## 11. Live2D and lip-sync requirements

- React never manipulates Cubism internals directly.
- `Live2DRenderer` owns Pixi and model lifecycle.
- `AvatarController` queues and resolves semantic avatar commands.
- Initialization is safe under React StrictMode and hot reload.
- Use `ResizeObserver`, a device-pixel-ratio cap, visibility pausing, WebGL
  context-loss recovery, and deterministic cleanup.
- Do not assume any expression, motion group, or parameter exists.
- Use time-domain PCM samples to calculate RMS.
- Apply noise gating, normalization, attack/release smoothing, and clamping.
- Apply mouth values at the correct point in the Live2D frame update so model
  motions do not overwrite lip sync.
- Prefer phoneme or viseme timing when available; use RMS as fallback.
- Support user interruption and barge-in.

## 12. Security and observability

- Treat model output and tool output as untrusted data.
- Defend tools against prompt injection, SSRF, path traversal, oversized
  inputs, secret disclosure, and cross-user access.
- Correlate `sessionId → turnId → runId → toolCallId`.
- Trace model calls, tools, guardrails, approvals, and handoffs with sensitive
  data redaction.
- Record time to first text/audio, total turn latency, tool latency, failure
  rate, interruption rate, reconnects, token use, and estimated cost.
- Store model, prompt, policy, and tool-schema versions with each run.

## 13. Verification strategy

Required test groups:

- Zod schema acceptance and rejection.
- Golden protocol compatibility fixtures.
- Sequence gaps, duplicates, acknowledgement, reconnect, and resume.
- State-machine transitions.
- Tool authorization, approval binding, cancellation, timeout, and redaction.
- Prompt-injection attempts through tool results.
- Missing avatar expressions and motions.
- Audio start/end, interruption, lip-sync smoothing, and cleanup.
- Fake-provider integration tests.
- Browser text, voice, avatar, and reconnect E2E tests.
- Concurrent session and backpressure load tests.

## 14. Implementation phases

### Phase 1 — Foundation

- [x] Scaffold the pnpm TypeScript workspace.
- [x] Add strict shared TypeScript and lint configuration.
- [x] Create `packages/protocol`.
- [x] Implement version 1.0 envelope and initial text/session events.
- [x] Add protocol fixtures and unit tests.
- [x] Add architecture, protocol, tool-policy, and threat-model documents.

Exit criteria:

- Typecheck, protocol tests, lint, and build pass.
- Both web and API packages import protocol types from the shared package.

### Phase 2 — Text-only vertical slice

- [x] Create Fastify API and WebSocket session handler.
- [x] Create React conversation UI.
- [x] Implement one deterministic fake agent provider.
- [x] Stream text events from API to browser.
- [x] Implement acknowledgement frames and basic exponential reconnect.
- [x] Add replay buffering, resume enforcement, and active heartbeat timers.

Exit criteria:

- [x] A browser can submit text and receive a streamed fake-agent response.
- [x] Protocol errors are rejected without crashing the connection.

### Phase 3 — Agent and tools

- [x] Integrate Ollama as the default provider and the OpenAI Agents SDK as an
  optional provider behind a shared interface.
- [x] Create the conversation manager and structured `AssistantTurn`.
- [x] Add a Level 0 read-only example tool.
- [x] Add a Level 1 tool with approval pause/resume.
- [x] Add tool audit, cancellation, timeout, and redaction tests.

### Phase 4 — Realtime voice

- [x] Create a server endpoint for short-lived Realtime client secrets.
- [x] Connect the browser with WebRTC.
- [x] Reconcile transcript and application events.
- [x] Add interruption and barge-in behavior.
- [x] Keep secrets and privileged tools server-side.

### Phase 5 — Live2D avatar

- [x] Confirm the dependency compatibility matrix and licenses.
- [x] Add documented Cubism/model placeholders.
- [x] Build `Live2DRenderer` and `AvatarController`.
- [x] Add the avatar capability manifest.
- [x] Map agent state and avatar cues with graceful fallbacks.
- [x] Add correct lip-sync smoothing and update ordering.

### Phase 6 — Persistence and durable work

- [ ] Add PostgreSQL schema and repositories.
- [ ] Persist conversations, events, tool calls, and approvals.
- [ ] Add Redis/BullMQ worker only for jobs that require durability.
- [ ] Add reconnect replay from the last acknowledged sequence.
- [ ] Add artifact references and retention policies.

### Phase 7 — Memory

- [ ] Implement session summaries.
- [ ] Add user-approved long-term memory candidates.
- [ ] Add provenance, confidence, TTL, sensitivity, and deletion.
- [ ] Test user and conversation isolation.

### Phase 8 — Bounded sub-agents

- [ ] Establish single-agent evaluation baselines.
- [ ] Add one read-only specialist agent.
- [ ] Enforce depth, time, token, tool, and concurrency limits.
- [ ] Compare correctness, latency, and cost with the baseline.
- [ ] Add further specialists only when measurements justify them.

### Phase 9 — Hardening and deployment

- [ ] Run failure-injection and concurrent-session tests.
- [ ] Add rate limits, queue backpressure, backups, and deletion workflows.
- [ ] Add prompt/model canary evaluation.
- [ ] Document deployment, monitoring, license setup, and incident recovery.

## 15. Immediate next action

Begin Phase 1 with no proprietary Live2D assets and no production API keys.
The first deliverable is a tested protocol package plus minimal web/API package
boundaries that compile against it.
