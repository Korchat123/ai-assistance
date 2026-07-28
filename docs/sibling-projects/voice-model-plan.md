# Assistant voice project plan

## Purpose

Repository: `C:\Users\korch\personal-program\voice-model`

Create and tune a distinctive text-to-speech voice for the AI assistant, with
local inference as the primary deployment target.

Speech recognition is not part of the first model milestone. The existing
browser/OpenAI transcription paths remain separate. This project initially owns
assistant speech generation only.

## Product boundary

This project owns:

- Consented voice recordings and dataset provenance.
- Audio cleaning, segmentation, transcripts, and pronunciation metadata.
- Model training or adaptation, evaluation, and export.
- A local streaming synthesis service.
- Optional phoneme/viseme timing for avatar lip synchronization.

The AI-assistance repository owns:

- What text may be spoken.
- Provider selection and cancellation.
- Conversation and interruption state.
- Playback, transcript display, and avatar projection.

The voice service must not receive tool credentials, conversation databases, or
raw private history beyond the bounded text selected for synthesis.

## Required service contract

Start with a provider-neutral local API:

```ts
type SynthesisRequest = {
  requestId: string;
  text: string;
  language: string;
  voice: string;
  speed?: number;
  style?: "neutral" | "warm" | "cheerful" | "serious" | "thinking";
};

type SynthesisMetadata = {
  sampleRate: number;
  encoding: "pcm_s16le" | "wav";
  durationMs?: number;
  phonemes?: Array<{ symbol: string; startMs: number; endMs: number }>;
  visemes?: Array<{ id: string; startMs: number; endMs: number }>;
};
```

Transport requirements:

- Health and capability endpoint.
- Streaming audio response when supported.
- Request cancellation by `requestId`.
- Bounded text length and output duration.
- No arbitrary file paths in requests.
- Model/version identifiers in every response.

## Decisions required before data collection

- [ ] Confirm the voice owner and written consent for training and deployment.
- [ ] Select supported language(s), accents, and code-switching requirements.
- [ ] Decide whether the voice is wholly original or adapted from the owner's
  recordings.
- [ ] Define permitted use, retention, redistribution, and revocation terms.
- [ ] Choose the target hardware and maximum acceptable first-audio latency.

Do not collect or train on third-party voices without explicit authorization.
Do not use scraped celebrity, streamer, actor, or private recordings.

## Implementation phases

### Phase A — Voice specification and consent

- [ ] Write the voice persona: pitch range, pace, warmth, energy, and style.
- [ ] Define supported languages and pronunciation expectations.
- [ ] Create consent, provenance, retention, and deletion records.
- [ ] Establish misuse rules and disclosure requirements.
- [ ] Define evaluation sentences that are separate from training data.

Exit criteria:

- Consent and permitted-use scope are documented.
- Target voice and language requirements are testable.
- Evaluation set and success thresholds are defined.

### Phase B — Baseline engine evaluation

- [ ] Compare suitable local TTS architectures and licenses.
- [ ] Measure CPU/GPU real-time factor, first-audio latency, memory, and size.
- [ ] Verify training/fine-tuning support for the selected language(s).
- [ ] Verify ONNX or another stable local deployment path if required.
- [ ] Record the choice in an ADR.

Exit criteria:

- One baseline voice synthesizes the evaluation set locally.
- Dependency and model licenses permit the intended use.
- Latency fits the target assistant interaction budget.

### Phase C — Dataset pipeline

- [ ] Publish recording instructions and microphone/environment requirements.
- [ ] Record clean, consented source audio.
- [ ] Preserve immutable raw recordings separately from derived data.
- [ ] Normalize sample rate without destructive over-processing.
- [ ] Segment utterances and produce exact transcripts.
- [ ] Detect clipping, long silence, noise, transcript mismatch, and duplicates.
- [ ] Split by utterance into train, validation, and held-out test sets.
- [ ] Create a dataset manifest with hashes and provenance.

Exit criteria:

- Every clip has consent, transcript, speaker, language, and hash metadata.
- No test sentence or near-duplicate appears in training.
- Automated quality checks pass and rejected clips remain auditable.

### Phase D — Training or adaptation

- [ ] Establish a reproducible baseline configuration and random seed.
- [ ] Train or adapt incrementally with checkpoint retention.
- [ ] Track losses alongside audible validation samples.
- [ ] Stop based on held-out quality, not training loss alone.
- [ ] Record code revision, dataset version, configuration, and hardware.

Exit criteria:

- A model card identifies data, limitations, license, and intended use.
- The selected checkpoint beats the baseline on predefined metrics.
- Training can be reproduced from manifests and configuration.

### Phase E — Evaluation and safety

- [ ] Measure intelligibility with word/character error rate using a separate
  recognizer.
- [ ] Measure speaker consistency without treating similarity as the only
  quality metric.
- [ ] Run blinded naturalness and preference listening tests.
- [ ] Test numbers, dates, URLs, abbreviations, code, names, Thai/English
  code-switching if applicable, and long sentences.
- [ ] Test prompt text that attempts to force unsafe audio or excessive output.
- [ ] Decide whether generated-audio disclosure or watermarking is required.

Exit criteria:

- Quality, latency, and safety thresholds pass on the held-out set.
- Known failure modes and prohibited uses appear in the model card.
- The release does not expose training recordings.

### Phase F — Local inference service

- [ ] Implement the health/capability endpoint.
- [ ] Implement bounded synthesis and streaming output.
- [ ] Implement cancellation and deterministic cleanup.
- [ ] Add text normalization and pronunciation dictionaries.
- [ ] Return phoneme or viseme timings when supported.
- [ ] Add concurrency, backpressure, timeout, and output-size limits.

Exit criteria:

- First audio meets the latency budget on target hardware.
- Cancellation stops compute and playback promptly.
- Concurrent requests cannot exhaust memory without bounded rejection.

### Phase G — AI-assistance integration

- [ ] Add a `local-model` voice provider behind the current voice controller.
- [ ] Keep browser speech and OpenAI Realtime as independent alternatives.
- [ ] Stream safe `speechText`, never raw tool output, secrets, URLs, or code.
- [ ] Feed returned visemes to the open avatar; use RMS only as fallback.
- [ ] Support barge-in by cancelling synthesis and audio playback together.
- [ ] Expose voice/model version in diagnostics.

Exit criteria:

- `VITE_VOICE_PROVIDER=local-model` selects the service without changing the
  text-agent provider.
- Ollama remains usable with the custom local voice.
- Interruption, reconnect, mute, and avatar lip sync pass browser tests.

### Phase H — Release and maintenance

- [ ] Version model, dataset, runtime, and pronunciation dictionary separately.
- [ ] Package checksums and model card with each release.
- [ ] Define rollback and compatibility policy.
- [ ] Monitor latency, synthesis failures, clipping, and user-reported
  pronunciation errors.
- [ ] Provide deletion/revocation handling for source voice data.

## Verification

- Dataset schema, hash, split-leakage, and audio-quality tests.
- Reproducible training smoke test on a small fixture.
- Held-out intelligibility and listening evaluations.
- Streaming/cancellation integration tests.
- Load and memory tests on target hardware.
- Long-text, multilingual, punctuation, and pronunciation tests.
- Voice-consent and release-manifest checks.

## Explicit non-goals

- Training speech recognition in the first milestone.
- Unauthorized voice cloning.
- Sending permanent API keys or agent tools to the synthesis service.
- Allowing arbitrary filesystem paths or shell commands through the API.
- Storing private conversation audio by default.

## First deliverable

A voice specification, consent/provenance template, target-hardware latency
budget, and an ADR comparing local TTS baselines. Do not begin expensive
training until the baseline and dataset acceptance tests are approved.
