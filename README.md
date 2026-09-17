# relay

Normalized harness observation and a host-local live-agent registry.

R2 adds bounded guard and observer dispatch to qualified process identity, twenty
event mappings, safe atomic registry publication, read-only listing and explicit
reaping. Node >=22; ES modules and built-ins only. Familiar retains presentation;
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
selector. No dependency installation or node_modules hydration is needed.

Read the [API contract](docs/api.md) and
[operator lock-repair procedure](docs/runbooks/registry-lock-repair.md).
State uses RELAY_STATE_DIR, otherwise XDG_STATE_HOME/relay or the home directory's
.local/state/relay. Supply a privately owned 0700 state directory; existing 0755
is rejected, never silently changed.

R2 adds `relay hook` and reconciling `relay reap`; subscribers come only from
`~/.config/relay/subscribers.json`. **No live hook is installed by this package.**
The OpenCode plugin must still not be enabled until `relay-baa816` and the
`ops-c8e4d1` probe pass. There is no installer, remote publication or consumer
migration in R2.

The approved parent design is in ops
`docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`).
The [extraction plan](docs/plans/2026-09-17-extraction.md) and
[lock-safety addendum](docs/specs/2026-09-17-registry-lock-safety.md) record local work.
The release goal is `relay-1231bf`; familiar migration is `fam-6e8321`, tasks identity
is `tasks-c9199a`, live tool/denial proof is `ops-c8e4d1`, and remote/tag portability
is `relay-c19c0a`. Physical Darwin process/terminal verification remains a release
requirement; portable Darwin UTC/local-timezone fixtures do not replace it.

Verified 2026-09-17: 186 tests pass through the full gate on Node 26.5.0 and
Node 22.23.2, including installed-tarball exports, JSON fixture, plugin and CLI.
Independent task and branch reviews passed; physical Darwin has not run.
