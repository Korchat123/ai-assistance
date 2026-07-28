# Protocol 1.0

All application events use a strict, versioned envelope and are validated at
runtime with Zod.

Phase 1 implements session start/resume, user text, cancellation,
acknowledgement, heartbeat, streamed assistant text, agent state, avatar cues,
turn completion, and safe server errors.

Sequence and replay enforcement are implemented by the Phase 2 WebSocket
session layer. Schema validation deliberately rejects invalid values instead
of silently clamping or coercing them.

## Phase 2 reliability

- Server events have monotonically increasing per-session sequence numbers.
- Clients cumulatively acknowledge the last applied server sequence.
- The server retains a bounded in-memory replay buffer.
- Reconnecting clients resume after their last acknowledged sequence.
- A missing replay range produces an explicit `replay_unavailable` error.
- Text commands carry stable command IDs and are deduplicated.
- Reusing a command ID with different input produces `command_conflict`.
- Only one text turn is active per session during this phase.
- Client and server heartbeat timers close stale connections.

The Phase 2 session store is intentionally in memory. Server restarts lose
session and replay state. When PostgreSQL is configured, the API hydrates the
bounded replay window and next sequence after a process restart.
