# Architecture

The system has four independent boundaries:

1. The browser presentation layer owns React, Live2D, local playback, and
   lip-sync.
2. The realtime voice layer uses WebRTC and short-lived browser credentials.
3. The API owns authentication, protocol validation, agent policy, approvals,
   and event persistence.
4. Workers own durable, long-running jobs and bounded specialist agents.

The shared protocol package is provider-independent. OpenAI event shapes and
Live2D implementation details must not leak into the domain protocol.

See [the main plan](../AGENTIC.md) for the full architecture and roadmap.
