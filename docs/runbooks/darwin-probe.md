# Darwin live probe

The physical Darwin validation relay's release requires (`relay-c19c0a`), run from a
bundle on a Mac. Design: `docs/specs/2026-09-25-darwin-probe.md`; plan:
`docs/plans/2026-09-25-darwin-probe.md`.

## Procedure

1. On the Linux host, from clean relay and ops checkouts:
   `just darwin-bundle <ops checkout>`, then `just darwin-bundle-check dist/relay-darwin-probe-<sha>.tar.gz`.
2. Copy the tarball to the Mac. There: `tar xzf relay-darwin-probe-<sha>.tar.gz && cd relay-darwin-probe-<sha> && ./run`.
   Prerequisites: Node >= 22, the Xcode Command Line Tools, python3 >= 3.11. Close OpenCode first; if you use Claude Code, have `claude setup-token` ready (the probe asks for its output at the start).
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
