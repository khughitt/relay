---
id: relay-060b50
title: "Installed hooks name a version-specific node, so removing that node silently disables relay guards"
status: idea
priority: 2
created: 2026-09-25T20:02:44Z
updated: 2026-09-25T20:02:44Z
depends: []
tags: []
source: relay-661946
agent: claude-code/claude-opus-5-5
---

Since relay-661946 every hook command runs relay.js through the installer's process.execPath. Under nvm that path is version-specific (and a Homebrew Cellar path may be too), so 'nvm uninstall' of that version makes every installed hook fail to start; Claude Code and Codex both treat that as a non-blocking hook failure, so guards stop guarding silently until 'relay install' reruns. Options: resolve through a stable shim path when one exists (Homebrew's /opt/homebrew/bin/node, nvm's alias dir), have 'relay install' warn when the node path is version-specific, or add a doctor check that every installed hook command's node exists. Evidence: Mac hand-back report for relay-661946 (2026-09-25).
