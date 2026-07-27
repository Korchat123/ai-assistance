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
