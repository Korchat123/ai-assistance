# Phase 8 bounded-specialist evaluation

## Decision

The single-agent path remains the default. One read-only code-analysis
specialist is available only through `/analyze <supplied text>`. No additional
specialists should be added until a versioned evaluation set demonstrates a
correctness gain that justifies the extra model call and latency.

## Baseline

The controlled baseline is the deterministic provider and the existing
single-agent WebSocket test:

| Path | Model calls | Specialist input/output | Tools | Delegation depth | Local API cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal message | 1 | 0 / 0 tokens | 0 | 0 | $0 |
| `/analyze` | 2 | at most 800 / 400 tokens | 0 | 1 | $0 |

Ollama is the default provider, so the monetary estimate is zero. CPU/GPU time
and electricity are real local costs but are not converted to USD. OpenAI
pricing is model-dependent and must be measured from provider usage metadata
before enabling delegation in a billed deployment.

## Automated comparison

The evaluation fixtures assert:

- Normal turns invoke one provider call.
- An explicit analysis invokes one specialist call and one manager synthesis.
- The manager receives the specialist result as untrusted data.
- Specialist input over 800 estimated tokens is rejected before a model call.
- Output is capped at 400 estimated tokens.
- Only one specialist can run concurrently.
- Depth is one, tool calls and retries are zero, and timeout is three seconds.
- Timeout, overload, or failure falls back to manager synthesis.

Correctness is checked on a controlled null-guard fixture: the specialist must
return evidence for the supplied snippet, while the manager remains responsible
for the final user-facing answer. Latency is recorded per specialist run using
a monotonic clock; delegation necessarily adds a second sequential model call,
so it is not used for ordinary conversation.

Run the evaluation with:

```powershell
corepack pnpm --filter @live2d-agent/api test
```

The current conclusion is to retain exactly one opt-in specialist. Broader
research, filesystem inspection, writes, approvals, nested delegation, and
parallel fan-out remain out of scope.
