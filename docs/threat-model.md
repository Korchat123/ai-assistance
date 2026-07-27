# Threat model

Initial trust boundaries:

- Browser input is untrusted.
- Model output is untrusted.
- Retrieved pages, files, and tool output are untrusted.
- The API, not a prompt, enforces authorization and approval.
- Browser code never receives server API keys or unrestricted tool secrets.

Threats covered by the design include prompt injection, tool argument
manipulation, cross-user data access, path traversal, SSRF, replay,
out-of-order events, oversized payloads, secret leakage, and approval reuse
after invocation arguments change.

Detailed mitigations and abuse cases will be expanded alongside each new tool
and persistence boundary.
