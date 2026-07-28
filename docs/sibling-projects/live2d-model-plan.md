# Open 2D avatar project plan

## Purpose

Repository: `C:\Users\korch\personal-program\live2d-model`

Build and author an original, animated 2D avatar for the AI assistant without
using Live2D Cubism Core, Cubism SDK, Cubism Editor, or Cubism model formats.

The repository name may remain `live2d-model`, but its output must be described
as an **open 2D avatar**, not a Live2D model. It will not generate
`.moc3`, `.model3.json`, or other Cubism-compatible assets.

## Product boundary

This project owns:

- Original source artwork and proof of asset rights.
- Layer naming, rig definition, meshes, deformation, and animation clips.
- An open, versioned avatar manifest and export validator.
- A small preview application for testing expressions, gestures, focus, and
  lip synchronization.
- A distributable avatar asset bundle.

The AI-assistance repository owns:

- Conversation and agent state.
- Semantic avatar cues.
- Audio-level and future viseme input.
- A renderer adapter that consumes the exported bundle.

The avatar bundle must never contain agent logic, API keys, or provider event
formats.

## Proposed output contract

Use a provider-neutral format rather than copying Cubism conventions:

```text
avatar-bundle/
├── avatar.json
├── textures/
├── meshes/
├── animations/
└── LICENSES/
```

Initial manifest:

```ts
type OpenAvatarManifest = {
  format: "open-avatar";
  version: "1.0";
  canvas: { width: number; height: number; pixelsPerUnit: number };
  textures: Array<{ id: string; url: string }>;
  parts: AvatarPart[];
  parameters: Record<string, ParameterDefinition>;
  expressions: Record<string, ParameterPose>;
  motions: Record<string, AnimationClip[]>;
  lipSync?: {
    mouthOpenParameter: string;
    visemes?: Record<string, ParameterPose>;
  };
};
```

Required semantic capabilities:

- Emotions: `neutral`, `happy`, `sad`, `angry`, `surprised`, `thinking`.
- Gestures: `idle`, `nod`, `wave`, `explain`, `shrug`.
- Focus input: normalized X/Y in `[-1, 1]`.
- Lip input: normalized mouth-open value in `[0, 1]`.
- Optional visemes with documented phoneme mapping.

Model-specific parameter and layer names remain internal to the bundle.

## Architecture decision checkpoint

Before building the full authoring pipeline, complete a short spike comparing:

1. A custom PixiJS mesh/deformer runtime aligned with the assistant’s existing
   renderer.
2. An established non-Cubism open avatar format/runtime, if it provides
   browser support, acceptable licensing, deterministic exports, and the
   required semantic controls.

Select an existing format only after confirming:

- Commercial and redistribution rights.
- Browser/WebGL support.
- TypeScript integration quality.
- Head/eye tracking and lip-sync hooks.
- Export tooling that does not require Cubism.
- Maintainability and active upstream ownership.

If no candidate meets those requirements, use the custom versioned format
above. Record the decision in an ADR before implementation.

## Implementation phases

### Phase A — Rights, requirements, and visual specification

- [ ] Confirm ownership or license for every source image, font, and reference.
- [ ] Define character sheet, front pose, palette, proportions, and safe areas.
- [ ] Choose target canvas size and texture budget.
- [ ] Define supported languages only if mouth shapes depend on phonemes.
- [ ] Define the minimum expression and gesture acceptance checklist.

Exit criteria:

- Rights manifest exists.
- Character turnaround and layer breakdown are approved.
- No borrowed proprietary model parts are present.

### Phase B — Format and runtime spike

- [ ] Write the format/runtime ADR.
- [ ] Render a layered head and torso in a browser.
- [ ] Demonstrate one mesh deformation.
- [ ] Demonstrate eye focus and one mouth-open parameter.
- [ ] Measure bundle size, frame time, and cleanup behavior.

Exit criteria:

- The spike runs at 60 FPS on the target development machine.
- Context loss, resize, and repeated mount/unmount do not leak resources.
- The chosen format can represent all required semantic capabilities.

### Phase C — Authoring and rig

- [ ] Produce clean separated art layers.
- [ ] Define draw order, masks, pivots, and mesh topology.
- [ ] Rig head angle, body angle, eye direction, blinking, brows, and mouth.
- [ ] Add physics only after deterministic parameter control works.
- [ ] Create neutral and all required emotion poses.

Exit criteria:

- Parameter sweeps have no visible tearing or invalid bounds.
- Missing optional physics does not affect core animation.
- Mouth input does not override unrelated facial parameters.

### Phase D — Motions and lip synchronization

- [ ] Author idle, nod, wave, explain, and shrug clips.
- [ ] Support interruption and cross-fade between clips.
- [ ] Add RMS mouth-open input.
- [ ] Add optional viseme poses and timing input.
- [ ] Ensure late lip-sync application is not overwritten by motions.

Exit criteria:

- Every semantic cue resolves or reports a graceful unsupported capability.
- Lip sync follows the provided signal without modifying agent state.
- Repeated interruptions return to a stable idle pose.

### Phase E — Exporter and validator

- [ ] Create deterministic bundle export.
- [ ] Validate schema, texture references, mesh indices, and animation targets.
- [ ] Reject absolute paths and path traversal.
- [ ] Generate hashes and a complete rights/license manifest.
- [ ] Add golden fixtures and malformed-bundle tests.

Exit criteria:

- Identical inputs produce byte-stable manifests.
- The validator rejects missing files, invalid indices, and unsupported
  versions.
- Exported bundles contain no source-editor secrets or unrelated files.

### Phase F — Assistant integration

- [ ] Add an `OpenAvatarRenderer` behind the existing avatar adapter.
- [ ] Select the renderer from the manifest `format` field.
- [ ] Keep the current Cubism adapter optional for licensed third-party models.
- [ ] Map existing semantic cues without changing the shared event protocol.
- [ ] Add browser tests for fallback, resize, interruption, and lip sync.

Exit criteria:

- The assistant loads the open avatar without Cubism Core.
- Removing the bundle returns to the placeholder without breaking chat/voice.
- Existing agent, tool, and voice tests remain unchanged.

### Phase G — Packaging and release

- [ ] Version the format and asset bundle independently.
- [ ] Publish checksums and license metadata.
- [ ] Define performance budgets and supported browsers.
- [ ] Add migration rules before any format-breaking change.
- [ ] Produce a signed release artifact for the AI-assistance project.

## Verification

- Schema and malformed-input tests.
- Golden render screenshots for core expressions and motions.
- Parameter-range and animation-interruption tests.
- WebGL context-loss and StrictMode lifecycle tests.
- 30-minute memory/GPU soak test.
- Frame-time tests at 1x and 2x device-pixel ratio.
- Asset-rights manifest validation.

## Explicit non-goals

- Reverse engineering Cubism formats.
- Generating `.moc3` or `.model3.json`.
- Copying proprietary Cubism Core behavior or code.
- Training an image model on unlicensed character art.
- Coupling the avatar runtime to OpenAI, Ollama, or a voice provider.

## First deliverable

An ADR plus a browser spike containing an original layered head, eye focus,
blinking, and mouth-open control. Do not begin the full character rig until the
format decision and rights checklist pass.
