# Darwin live probe

The physical Darwin validation that installing relay hooks on a Mac requires
(`relay-848c0f`), run from a bundle on a Mac. It does not gate the release: v0.1.0
published on Linux evidence (`docs/runbooks/release.md`). Design: `docs/specs/2026-09-25-darwin-probe.md`; plan:
`docs/plans/2026-09-25-darwin-probe.md`.

## Procedure

1. On the Linux host, from clean relay and ops checkouts:
   `just darwin-bundle <ops checkout>`, then `just darwin-bundle-check dist/relay-darwin-probe-<sha>.tar.gz`.
2. Copy the tarball to the Mac. There: `tar xzf relay-darwin-probe-<sha>.tar.gz && cd relay-darwin-probe-<sha> && ./run`.
   Prerequisites: Node >= 22, the Xcode Command Line Tools (they provide the `cc` that builds the probe's constructed harness parents), python3 >= 3.11. Close OpenCode first; if you use Claude Code, have `claude setup-token` ready (the probe asks for its output at the start).
3. Copy `relay-darwin-results-<stamp>.tar.gz` back and run `just darwin-judge <tarball> <ops checkout>`.
   Commit the appended section and `darwin-evidence.json`.

OpenCode is pinned to v2.0.15 (request `GET /api/plugin?location[directory]=<dir>`, Basic
auth `opencode:$OPENCODE_SERVER_PASSWORD`). At that version relay's plugin is rejected
until `relay-d0a8df` lands, so D7b's cutover verdict is expected to fail.

## Attempts

## Attempt 2026-09-25T17:01:37.126Z — darwin

relay `b7fc410a71e40d691b4282a89bb8550a3d505eef`, ops `ff9bfb036512e970e849f7bcf85e4a23925bb662`; macOS 26.7 (25G229), arm64; node v25.8.2, Python 3.14.7; harnesses: claude 2.1.273 (Claude Code) (/Users/<user>/.local/share/claude/versions/2.1.273); codex codex-cli 0.149.0 (/Users/<user>/.nvm/versions/node/v25.8.2/lib/node_modules/@openai/codex/bin/codex.js); opencode 1.18.21 (/Users/<user>/.nvm/versions/node/v25.8.2/lib/node_modules/opencode-ai/bin/opencode.exe).

Release: **incomplete**. Cutover: claude-code pass, codex pass, opencode fail, launchd-path error.

| Check | Class | Verdict | Detail |
| --- | --- | --- | --- |
| D0 | release | pass | environment recorded |
| D1 | release | pass | package installs offline and loads |
| D2 | release | fail | 248/249 passed, 0 skipped |
| D3 | release | pass | identity agrees across readers and zones |
| D4 | release | error | stage error |
| D5 | release | error | stage error |
| D6 | release | pass | replies match the Linux replay; hung guards refused and gone |
| D8 | release | error | stage error |
| ISO | release | pass | no live path changed |
| D7w | release | pass | live hook ancestry read in full |

**Findings**

- D0: HostName is not set: the host name can change with the network (spec item 4)
- D2: failed test: eight real processes retain all counter updates, including dead main reclamation
- D3: zombie child reads alive (qualified process matches) (spec item 5)

## Attempt 2026-09-25T18:02:51.744Z — darwin

relay `0b92d14ddc2aaf3c8d8d1454f28f05bd3907a090`, ops `ff9bfb036512e970e849f7bcf85e4a23925bb662`; macOS 26.7 (25G229), arm64; node v25.8.2, Python 3.14.7; harnesses: claude 2.1.282 (Claude Code) (/Users/<user>/.local/share/claude/versions/2.1.282); codex codex-cli 0.149.0 (/Users/<user>/.nvm/versions/node/v25.8.2/lib/node_modules/@openai/codex/bin/codex.js); opencode 1.18.21 (/Users/<user>/.nvm/versions/node/v25.8.2/lib/node_modules/opencode-ai/bin/opencode.exe).

Release: **fail**. Cutover: claude-code pass, codex fail, opencode fail, launchd-path fail.

| Check | Class | Verdict | Detail |
| --- | --- | --- | --- |
| D0 | release | pass | environment recorded |
| D1 | release | pass | package installs offline and loads |
| D2 | release | fail | 248/249 passed, 0 skipped |
| D3 | release | pass | identity agrees across readers and zones |
| D4 | release | fail | ancestry, recognition or argument mismatch |
| D5 | release | pass | registry, lock, reap and hook cost hold |
| D6 | release | pass | replies match the Linux replay; hung guards refused and gone |
| D8 | release | pass | reap in a launchd-like environment keeps exactly the live agents |
| ISO | release | pass | no live path changed |
| D7w | release | pass | live hook ancestry read in full |

**Findings**

- D0: HostName is not set: the host name can change with the network (spec item 4)
- D2: failed test: the CLI returns inside the outer timeout while another writer holds the lock
- D3: zombie child reads alive (qualified process matches) (spec item 5)
- D4: Darwin comm holds the executable path (spec item 2)
- D4: process table: 671 rows, 460 past the cut, 0 truncated as relay reads it
- D5: 50 agents: PreToolUse 207.156875 ms, SessionEnd 152.636125 ms (exit 0)
- ISO: changed while D9 sampled live sessions (not gated): .codex/config.toml, .codex/auth.json

**ps width:** 671 rows, 460 past the cut, 0 truncated as relay reads them; comm holds the path.

### Diagnosis of attempts 1 and 2

- Attempt 1 (bundle `b7fc410`): D4, D5 and D8 errored because the probe's constructed
  harness parents were copies of `/bin/sh`, which macOS 26 would not run from `/tmp`
  (launch constraints on Apple platform binaries). Fixed by compiling a small parent with
  `cc` (`tools/darwin-probe/lib/parent.c`) and checking it runs before any stage uses it.
  D2 failed relay's lock-multiprocess test on Darwin (`relay-6e9410`).
- Attempt 2 (bundle `0b92d14`): D5 and D8 now pass on Darwin. Remaining failures are relay
  defects the probe was built to find:
  - D2: `LOCK_IDENTITY_UNKNOWN` in `test/cli.test.js`'s lock-timeout test; the Darwin
    identity read of the lock holder fails intermittently under contention (`relay-6e9410`).
  - D4: Darwin `ps -o comm=` is argv[0], not the executable path, so `executableOf` returns
    `9.9.9` and native Claude installs are not recognized (`relay-7eef39`). The D4
    `comm_kind` finding ("executable path") came from a process whose argv[0] was its path;
    the argv0 case shows the opposite (`relay-cd176c`).
  - D8 hook path (cutover): the installed hook command runs `relay.js` through
    `/usr/bin/env node`, which fails under launchd's PATH (`relay-661946`).
  - D7 codex (cutover): the live allow run exited 1 after 38 s; the results carry no harness
    stderr to diagnose it (`relay-cd176c`). Claude Code was proven live in both attempts;
    codex was proven in attempt 1.
