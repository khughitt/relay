# Darwin live probe

Type: operator guide; document types 1.

The physical Darwin validation that installing relay hooks on a Mac requires, run from a bundle on a Mac. It does not gate the release: v0.1.0 published on Linux evidence ([release.md](release.md)).

## Procedure

1. On the Linux host, from clean relay and ops checkouts:
   `just darwin-bundle <ops checkout>`, then `just darwin-bundle-check dist/relay-darwin-probe-<sha>.tar.gz`.
2. Copy the tarball to the Mac. There: `tar xzf relay-darwin-probe-<sha>.tar.gz && cd relay-darwin-probe-<sha> && ./run`.
   Prerequisites: Node >= 22, the Xcode Command Line Tools (they provide the `cc` that builds the probe's constructed harness parents), python3 >= 3.11. Close OpenCode first; if you use Claude Code, have `claude setup-token` ready (the probe asks for its output at the start).
3. Copy `relay-darwin-results-<stamp>.tar.gz` back and run `just darwin-judge <tarball> <ops checkout>`.
   Copy the appended `## Attempt <ts> — <platform>` section from `docs/runbooks/darwin-probe.md` into `records relay/docs/notes/2026-09-25-darwin-probe-attempts.md`, archive `docs/runbooks/darwin-evidence.json` in `records` (under `records relay/docs/runbooks/darwin-evidence.json` or attached to the probe task), and restore the clean working tree before committing (`git checkout -- docs/runbooks/darwin-probe.md && rm -f docs/runbooks/darwin-evidence.json`).

OpenCode is pinned to v2.0.15 (request `GET /api/plugin?location[directory]=<dir>`, Basic auth `opencode:$OPENCODE_SERVER_PASSWORD`). At that version relay's plugin is rejected until the OpenCode plugin query parameter change lands, so D7b's cutover verdict is expected to fail.

## Attempts
