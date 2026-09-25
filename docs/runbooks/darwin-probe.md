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
