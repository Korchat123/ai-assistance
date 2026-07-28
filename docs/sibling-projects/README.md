# Sibling project coordination

The AI assistant is coordinated with two independent sibling repositories:

- `live2d-model`: produces an open, non-Cubism 2D avatar bundle and preview.
- `voice-model`: produces a consented local TTS model and synthesis service.

Each repository owns its training/authoring inputs, licenses, tests, and release
artifacts. This repository consumes only versioned outputs through provider
interfaces.

Integration order:

1. Stabilize the open avatar manifest and renderer adapter.
2. Stabilize the local synthesis API and cancellation behavior.
3. Add viseme timing from the voice service to the avatar provider.
4. Run end-to-end latency, interruption, and resource-cleanup tests.

Detailed plans:

- [Open 2D avatar plan](./live2d-model-plan.md)
- [Assistant voice plan](./voice-model-plan.md)
