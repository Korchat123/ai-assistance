# Protocol 1.0

All application events use a strict, versioned envelope and are validated at
runtime with Zod.

Phase 1 implements session start/resume, user text, cancellation,
acknowledgement, heartbeat, streamed assistant text, agent state, avatar cues,
turn completion, and safe server errors.

Sequence, replay, and state-machine enforcement will be added with the
WebSocket session implementation in Phase 2. Schema validation deliberately
rejects invalid values instead of silently clamping or coercing them.
