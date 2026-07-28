# Persistence and durable-work policy

The API uses repository interfaces with two implementations:

- In-memory persistence is the zero-configuration local default.
- PostgreSQL persistence is enabled when `DATABASE_URL` is set.

## PostgreSQL setup

Create a database, set `DATABASE_URL` in the root `.env`, then run:

```powershell
corepack pnpm migrate
```

The migration at `apps/api/migrations/001_phase6.sql` creates conversations,
ordered conversation messages, sessions, run events, tool-call projections,
approvals, and artifact references. Migrations are explicit and are not run
automatically when the API starts.

`apps/api/migrations/002_phase7_memory.sql` adds session owner IDs,
per-conversation summaries, memory candidates, and active memory items.

Server events are written in session-sequence order. Acknowledgements only move
forward. On reconnect after a process restart, the API hydrates at most the
protocol replay limit and rejects requests older than that retained window.
Ordered user and assistant messages hydrate the model-facing conversation
history independently from the replay projection.

## Summaries and long-term memory

After each assistant response, the API stores a bounded deterministic summary
of the latest conversation messages. Summaries are keyed by conversation and
cannot mix messages from another conversation.

Long-term memory is keyed by the session's browser client ID. A `/remember`
command first creates a pending candidate with conversation and turn
provenance. Only an explicit `memory.resolve` approval creates an active memory.
Reads, approvals, and deletion are owner-scoped; expired and soft-deleted rows
are excluded. Approved memory is supplied to the model as untrusted user context
and is never treated as instructions.

The current client ID is a random value kept in browser local storage. This is
appropriate for a single-user local prototype, but it is not a security
boundary: a production deployment must derive the owner ID from authenticated
server-side identity instead of accepting a browser-provided ID.

## Tool and approval records

Tool records store lifecycle state, argument hashes, bounded redacted output,
and redacted errors. Approval records are bound to the tool call, conversation,
turn, and argument hash. Actual tool input and secrets are not copied into the
approval table.

Pending approvals are not executable after a process restart in this phase.
Their audit records remain durable, but the user must retry the original
command so the server can reconstruct an active, revalidated invocation.

## Artifacts and retention

The database stores artifact metadata and opaque storage keys, not artifact
bytes. Every artifact may have an `expires_at` timestamp. The repository can
delete expired metadata and return its storage references to the owning storage
adapter. A future durable cleanup job must coordinate and retry physical object
deletion before considering end-to-end retention complete.

## Why Redis and BullMQ are not active yet

The current system has no delayed or long-running background job. Conversation
turns and example tools are bounded request work. Adding Redis/BullMQ now would
create operational state without a job that needs durable retries. The worker
will be introduced with the first artifact-generation, delayed, or external
workflow that cannot safely finish inside the conversation process.
