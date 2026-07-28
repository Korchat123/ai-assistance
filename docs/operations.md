# Deployment and operations

## Supported deployment shape

Build with `corepack pnpm check`, run migrations, then start the compiled API
and serve `apps/web/dist` behind a TLS reverse proxy. The API binds to
`127.0.0.1` by default and should remain private behind that proxy.

Use PostgreSQL for any deployment that must survive restarts. The in-memory
repository is development-only. Session execution state is process-local, so
run one API replica until sticky routing or a shared session coordinator is
implemented. OpenAI Realtime credentials and WebSockets require correct proxy
upgrade and forwarded-origin configuration.

Before promotion:

```powershell
corepack pnpm check
corepack pnpm migrate
corepack pnpm --filter @live2d-agent/api canary
```

A failed canary blocks promotion. Run it against the exact
`AGENT_PROVIDER`/model candidate. The suite checks response validity, latency,
and a prompt-injection secret-leak fixture.

## Capacity and backpressure

Configure conservative values first:

```env
MAX_WS_CONNECTIONS=100
MAX_WS_QUEUED_MESSAGES=32
REALTIME_REQUESTS_PER_MINUTE=10
WS_MAX_PAYLOAD_BYTES=65536
```

Excess WebSockets close with code `1013`. A session whose inbound queue is full
also closes with `1013`, allowing the browser's bounded reconnect logic to
retry. Oversized frames are rejected by the WebSocket server. Realtime
credential requests return `429`, `Retry-After`, and rate-limit headers.

The limiter is process-local. A multi-replica deployment requires a shared
limiter or enforcement at the reverse proxy.

## Monitoring

Poll `GET /health`; alert on non-200 responses and sustained high
`activeWsConnections`. Collect process logs and reverse-proxy metrics for:

- HTTP 429/5xx rate and WebSocket close codes 1008, 1011, and 1013.
- Turn failure, cancellation, provider timeout, and tool timeout rates.
- PostgreSQL connection saturation, storage growth, and backup age.
- Canary pass rate and per-case latency.
- Ollama CPU/GPU saturation or OpenAI request latency and billed usage.

Never log API keys, raw approval inputs, memory contents, or full tool output.

## PostgreSQL backup and restore

Create a restricted backup directory outside the repository. Use PostgreSQL's
custom format so restore can select objects and run integrity checks:

```powershell
pg_dump --dbname="$env:DATABASE_URL" --format=custom --file="ai-assistance.dump"
pg_restore --list "ai-assistance.dump"
```

Test restoration regularly into an empty non-production database:

```powershell
createdb ai_assistance_restore_test
pg_restore --dbname="ai_assistance_restore_test" --clean --if-exists "ai-assistance.dump"
```

Encrypt backups, restrict access, rotate them according to the retention
policy, and keep at least one copy outside the deployment host. A backup is not
accepted until a restore test and representative row-count checks pass.

## Owner-data deletion

Stop or drain the API first so an active browser cannot recreate data during
deletion. Obtain the exact browser client ID, take an auditable backup if policy
requires it, then run:

```powershell
corepack pnpm --filter @live2d-agent/api delete:client-data -- --client-id EXACT_ID --confirm
```

This transaction removes the owner's sessions, conversations, events,
messages, summaries, tools, approvals, artifact metadata, candidates, and
memories. Physical artifact objects referenced by deleted metadata must also be
removed from the configured object store. Verify the deletion before bringing
traffic back.

## License gate

The default placeholder does not redistribute proprietary Live2D assets.
Before deployment, inventory PixiJS and adapter licenses and verify explicit
redistribution rights for Cubism Core, every model, texture, motion, font,
voice dataset, and trained voice checkpoint. Keep proprietary model and Core
files out of Git. The open avatar and consented voice sibling projects have
separate provenance and release gates.

## Incident recovery

1. Contain: disable Realtime minting, revoke exposed API keys, and drain new
   WebSocket traffic.
2. Preserve: retain sanitized logs, timestamps, affected IDs, deployed commit,
   prompt/model configuration, and canary output.
3. Recover: rotate secrets, restore PostgreSQL into an isolated database,
   validate migrations and row counts, then deploy the last known-good build.
4. Verify: run `check`, migrations, canary, health probes, text turns, approval
   binding, memory isolation, and reconnect tests.
5. Review: document scope, root cause, user-data impact, corrective controls,
   and whether affected backups or artifacts require deletion.

Do not restore over the only production database. Restore separately, inspect,
then perform a controlled cutover with a rollback point.
