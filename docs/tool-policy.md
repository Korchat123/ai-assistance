# Tool policy

Tools are denied by default and registered with:

- Runtime-validated arguments.
- Capability and risk metadata.
- User and resource authorization.
- Timeout, cancellation, quota, and output-size controls.
- Secret redaction, audit events, and idempotency behavior.

Only scoped read-only tools may run automatically. External communication,
account changes, destructive actions, privileged operations, and financial
actions require approval bound to the exact validated invocation.

Phase 3 includes two intentionally small examples:

- `read_context` (Level 0) reads a scoped in-memory value and runs
  automatically.
- `set_context` (Level 1) updates a scoped in-memory value only after the
  browser resolves the exact approval ID. Its normalized arguments are bound
  by a SHA-256 hash.

Try them with `/read project` and `/set theme blue`. Tool output and audit
errors are bounded and redacted before they cross the server boundary.
