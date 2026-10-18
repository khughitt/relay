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
selector. The one runtime npm dependency, `jsonc-parser`, is installed by npm with relay and
used only by `relay install`; `just setup` also installs development-only TypeScript and Node 22
types. `just check` runs strict JSDoc type checking over every `src/` and `bin/` file
without emitting code. Shared contracts live in `src/types.js`; compile-time
regressions live in `test/types/`. JavaScript runs directly, with no build step.

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
Each installed entry runs relay.js through the installer's own node. Under nvm, fnm, Volta,
asdf, mise or a Homebrew Cellar that path belongs to one Node version, and removing that
version silently stops the hooks; `relay install` warns when it would write such a path,
and `--node PATH` names a node that outlives version changes instead.
The OpenCode plugin must still not be enabled until `relay-baa816` and the
`ops-c8e4d1` probe pass. `relay serve` now owns a durable interaction inbox with
local desk commands and optional tailnet HTTP access; see the
[inbox service runbook](docs/runbooks/inbox-service.md). Installation of the Claude
question route is evidence-gated; the user-present [acceptance run](docs/runbooks/inbox-e2e-2026-10.md)
passed phone answer, phone defer and desk withdrawal.

The approved parent design is in ops
`docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`).
The [extraction plan](docs/plans/2026-09-17-extraction.md) and
[lock-safety addendum](docs/specs/2026-09-17-registry-lock-safety.md) record local work.
The release goal is `relay-1231bf`; familiar migration is `fam-6e8321`, tasks identity
is `tasks-c9199a`, live tool/denial proof is `ops-c8e4d1`, and remote/tag portability
is `relay-c19c0a`. v0.1.0 is verified on Linux; on Darwin it is fixture-tested only, and
the physical probe (`relay-848c0f`) gates installing relay hooks on a Mac. Portable Darwin
UTC/local-timezone fixtures do not replace that probe. The
[release record](https://github.com/khughitt/relay/blob/main/docs/runbooks/release.md) says what v0.1.0 verifies.

Verified 2026-09-17: 187 tests pass through the full gate on Node 26.5.0 and
Node 22.23.2, including installed-tarball exports, JSON fixture, plugin and CLI.
Independent task reviews and the final branch review completed; physical Darwin has not run.

Typed interaction verification, 2026-10-13: all 576 tests pass on Node 26.5.0 and
Node 22.23.2 with test file concurrency 1, including the installed schema/runbook
tarball smoke. The user-present [acceptance run](docs/runbooks/inbox-e2e-2026-10.md)
passed all three cases. Default-scheduler fixture flakes remain tracked separately.
