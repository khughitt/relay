# relay

Harness adapters, a host-local live-agent registry, and synchronous hook dispatch.

Status: local bootstrap complete; the runtime and release are not implemented.
Familiar will own presentation; ohai remains the notification client.

The approved design is in ops
`docs/specs/2026-09-16-relay-design.md` (revision `d7e2c33`).
The first release goal is `relay-1231bf`; run `tasks tree relay-1231bf`.
Next: `relay-06b1da`, execute the approved
[adapters/process/registry extraction plan](docs/plans/2026-09-17-extraction.md).
Its [registry-lock safety addendum](docs/specs/2026-09-17-registry-lock-safety.md)
is approved.
Familiar migration is scheduled as `fam-6e8321`; tasks identity design is
`tasks-c9199a`. Publication and operator cutover are still pending.
