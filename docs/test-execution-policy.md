# Test execution policy

Type: reference.

Routine broad local verification is disabled by the committed .tt.toml after
[accepted hosted verification](https://github.com/khughitt/relay/actions/runs/41063297144)
on Node 22 and 26: each ran 784 tests, all passed, zero reported skips and zero
excluded modules. Runtime tests and package exports are unchanged. The activation
push is checked by the same forced workflow; exact run evidence is retained on
relay-df16ab, with rollout state reported to ops-8bfa85.

Use `just test-one <file>` or `just test-one --test-name-pattern '<regex>' <file>`
while implementing. Arguments pass intact to Node. Fast and full targets both
run the entire npm test script; there is no affected-test selector.

The invoking code checkout's Git root supplies .tt.toml. Detached task records
and neighboring checkouts supply no execution policy. With automatic_broad=false,
the exact broad targets are test, test-fast and
check-code. Focused tests and mandatory hygiene still run. Invalid policy fails;
a recorded skip has null outcomes and is never a test pass or timing sample.

`just check-hygiene` runs ops-check and tasks check. `just check-code` runs strict
TypeScript checking including test/types contracts. `just check` composes both;
`just gate` adds the full suite. Both hooks always run hygiene before requesting
broad children. Their timing series now covers hygiene only; compare neither
with historical whole-hook timings nor with suite duration.

`just test-full` forces a deliberate full suite through TT_FORCE=1. To force the
whole check chain, use `TT_FORCE=1 just check`. Forced failure remains a failure.
Hosted workflows must explicitly set TT_FORCE=1 for all nested invocations;
a hosted broad skip without force is a configuration error.

Hosted verification uses standard Ubuntu 24.04 runners on Node 22 and
26, once per branch push with superseded runs cancelled, plus manual dispatch.
The pinned setup installs attr, lsof and util-linux; just is copied into /usr/bin
so tests with a system-only PATH can find it. Checkout keeps no token in Git
configuration. Both jobs force nested verification with TT_FORCE=1.

Tags and other remotes have no declared automatic coverage. An uncovered push
warns under policy-off and does not silently restore local broad testing.
Cancelled, missing, failed or empty runs are unverified.

Hosted hygiene runs ops-check via `just ci-check-hygiene`; detached tasks check
is omitted and remains mandatory locally. No private records are fetched. Linux
runs include Darwin fixtures, but do not establish live Darwin process behavior
or live Claude, Codex or OpenCode acceptance. Preserve and report all additional
skips and module omissions per runtime before accepting coverage.

One generated terminal-HUP case differs from the 785-test local suite: the
existing probe fixture loop deduplicates /bin/sh and Dash realpaths. Ubuntu's
/bin/sh is Dash, so the hosted suite runs only the Dash case; this development
host also runs Bash. No module is excluded. Bash-specific HUP behavior remains
locally covered rather than routinely verified by this hosted workflow.

The hosted namespace setup deliberately sets only
kernel.apparmor_restrict_unprivileged_userns=0 within each disposable VM, then
requires the real unprivileged PID-namespace preflight. This increases kernel
attack surface for the VM's lifetime to retain that test. It writes no persistent
sysctl configuration and must never be run on development or self-hosted machines.
The initial hosted setup and bounded activation pushes were explicitly approved;
additional publishing or hosted invocations outside that grant need authorization.

Rollback sets automatic_broad=true and restores local broad cadence. Record the
landed enabled revision/time on the adoption task; old timing samples do not
establish a fresh latency failure. Disabled obligations are retired explicitly,
never reported as performance-verified.
