---
id: relay-060b50
title: "Installed hooks name a version-specific node, so removing that node silently disables relay guards"
status: doing
priority: 2
size: s
complexity: mid
process: direct
owner: fix/node-path
created: 2026-09-25T20:02:44Z
updated: 2026-10-14T23:25:46Z
started: 2026-10-14T23:11:45Z
depends: []
tags: []
source: relay-661946
agent: claude-code/claude-opus-5-5
---

Why: since relay-661946 (1f1d102) every installed hook command runs relay.js through `process.execPath` (bin/relay.js:134-135 pass it as nodeBin to planClaudeCode/planCodex; src/install/hooks.js:31). Under nvm, fnm, volta, asdf or a Homebrew Cellar that path names one Node version, and Node reports the resolved binary, so even a stable symlink shim is lost. Removing that version makes every hook fail to start; Claude Code and Codex treat that as a non-blocking hook failure, so guards stop guarding silently until `relay install` reruns. The same holds for relayBin (`realpathSync(process.argv[1])`) when relay is installed as a global npm package under a version manager. This host runs Node from ~/.nvm/versions/node/v26.5.0, so the default install here is affected. Evidence: Mac hand-back report for relay-661946 (2026-09-25).

Approach: add an explicit `relay install --node PATH` (absolute, existing, executable) that becomes nodeBin, default unchanged. When the node or relay path that will be written sits under a version-specific directory (nvm/fnm/volta/asdf versions dirs, Homebrew Cellar), `relay install` prints a warning on stderr naming the path, the failure mode and `--node`. No automatic shim discovery: guessing a different binary is a silent fallback. A doctor command that checks installed hooks is out of scope; file it separately if wanted.

Done: tests cover `--node` reaching both planners and the written commands, its validation (relative, missing, non-executable refuse with USAGE), the warning for nvm- and Cellar-shaped node paths and for a versioned relayBin, and no warning for /usr/bin/node; README and docs/runbooks/hook-install-rollback.md mention `--node`; `just test-fast` passes on Node 22 and the dev runtime.

Where: bin/relay.js:126-140 (install flag parsing and planner calls), src/install/hooks.js, src/install/claude-code.js, src/install/codex.js, test/install-cli.test.js.

## Notes

- 2026-10-13T08:30:18Z (main): scope: scoped; chose an explicit --node flag plus a version-specific-path warning (rejected automatic shim discovery as a silent fallback; doctor check left out of scope); also covers a versioned relayBin; todo P2 s mid direct
- 2026-10-14T23:11:45Z (main): started
  provenance: {"harness_session":"claude-code:711a298e-1d8a-4d9f-b6a1-c21f9fd625ed","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-14T23:11:52Z (fix/node-path): resumed
  provenance: {"harness_session":"claude-code:711a298e-1d8a-4d9f-b6a1-c21f9fd625ed","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-10-14T23:20:15Z (fix/node-path): cross-project: --node row added to ops cli.toml as ops 05e7db2 (ff-merged to ops main, not pushed); tools/cli.toml re-adopted from it in f122e18
- 2026-10-14T23:25:46Z (fix/node-path): review: impl round 1 — verdict: revise; findings: Critical 0, Important 2, Minor 6; reviewer: claude-code
