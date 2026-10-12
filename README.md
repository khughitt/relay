# relay

Normalized harness observation and a host-local live-agent registry.

R2 adds bounded guard and observer dispatch to qualified process identity, twenty
event mappings, safe atomic registry publication, read-only listing and explicit
reaping. Node >=22; ES modules and built-ins only, except the installer's
jsonc-parser. Familiar retains presentation;
ohai remains the notification client.

```sh
just setup
just test-fast
just gate
node bin/relay.js list --json
node bin/relay.js reap
node bin/relay.js hook --harness claude-code PreToolUse < payload.json
```

The fast and full suites are intentionally identical; there is no affected-only
selector. The one npm dependency, `jsonc-parser` (bundled), is needed only by
`relay install`; `just setup` installs it.

Read the [API contract](docs/api.md) and
[operator lock-repair procedure](docs/runbooks/registry-lock-repair.md).
State uses RELAY_STATE_DIR, otherwise XDG_STATE_HOME/relay or the home directory's
.local/state/relay. Supply a privately owned 0700 state directory; existing 0755
is rejected, never silently changed. The registry is schema 2: each agent's handle
names the session's own process. Upgrading from schema 1 is `relay reap`, and on a
host using tasks' relay identity, tasks is upgraded first; see the
[hook install runbook](docs/runbooks/hook-install-rollback.md#activating-session-handles-registry-schema-2).

R2 adds `relay hook` and reconciling `relay reap`; subscribers come from
`~/.config/relay/subscribers.json` for a direct `relay hook`, and from the
`--subscribers FILE` an installed entry names. **No live hook is installed by this package.**
The OpenCode plugin must still not be enabled until `relay-baa816` and the
`ops-c8e4d1` probe pass. `relay serve` now owns a durable interaction inbox with
local desk commands and optional tailnet HTTP access; see the
[inbox service runbook](docs/runbooks/inbox-service.md). Installation of the Claude
question route is evidence-gated; user-present end-to-end acceptance remains pending.

The approved parent design is in ops
`docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`).
The [extraction plan](docs/plans/2026-09-17-extraction.md) and
[lock-safety addendum](docs/specs/2026-09-17-registry-lock-safety.md) record local work.
The release goal is `relay-1231bf`; familiar migration is `fam-6e8321`, tasks identity
is `tasks-c9199a`, live tool/denial proof is `ops-c8e4d1`, and remote/tag portability
is `relay-c19c0a`. Physical Darwin process/terminal verification remains a release
requirement; portable Darwin UTC/local-timezone fixtures do not replace it.

Verified 2026-09-17: 187 tests pass through the full gate on Node 26.5.0 and
Node 22.23.2, including installed-tarball exports, JSON fixture, plugin and CLI.
Independent task reviews and the final branch review completed; physical Darwin has not run.

Typed interaction gate, 2026-10-12: 571 tests pass on Node 26.5.0 and Node 22.23.2,
including the installed schema/runbook tarball smoke. User-present tailnet acceptance
(Task 14) is pending.
