---
id: relay-060b50
title: "Installed hooks name a version-specific node, so removing that node silently disables relay guards"
status: todo
priority: 2
size: s
complexity: mid
process: direct
created: 2026-09-25T20:02:44Z
updated: 2026-10-13T08:30:18Z
depends: []
tags: []
source: relay-661946
agent: claude-code/claude-opus-5-5
---

Why: since relay-661946 (1f1d102) every installed hook command runs relay.js through `process.execPath` (bin/relay.js:134-135 pass it as nodeBin to planClaudeCode/planCodex; src/install/hooks.js:31). Under nvm, fnm, volta, asdf or a Homebrew Cellar that path names one Node version, and Node reports the resolved binary, so even a stable symlink shim is lost. Removing that version makes every hook fail to start; Claude Code and Codex treat that as a non-blocking hook failure, so guards stop guarding silently until `relay install` reruns. The same holds for relayBin (`realpathSync(process.argv[1])`) when relay is installed as a global npm package under a version manager. This host runs Node from ~/.nvm/versions/node/v26.5.0, so the default install here is affected. Evidence: Mac hand-back report for relay-661946 (2026-09-25).

Approach: add an explicit `relay install --node PATH` (absolute, existing, executable) that becomes nodeBin, default unchanged. When the node or relay path that will be written sits under a version-specific directory (nvm/fnm/volta/asdf versions dirs, Homebrew Cellar), `relay install` prints a warning on stderr naming the path, the failure mode and `--node`. No automatic shim discovery: guessing a different binary is a silent fallback. A doctor command that checks installed hooks is out of scope; file it separately if wanted.

Done: tests cover `--node` reaching both planners and the written commands, its validation (relative, missing, non-executable refuse with USAGE), the warning for nvm- and Cellar-shaped node paths and for a versioned relayBin, and no warning for /usr/bin/node; README and docs/runbooks/hook-install-rollback.md mention `--node`; `just test-fast` passes on Node 22 and the dev runtime.

Where: bin/relay.js:126-140 (install flag parsing and planner calls), src/install/hooks.js, src/install/claude-code.js, src/install/codex.js, test/install-cli.test.js.
