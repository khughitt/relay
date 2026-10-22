---
id: relay-cfd24b
title: "claude-code adapter: resolveTerminalPid matches only comm 'claude', while isHarness also accepts the native installer's versioned binary, so a session launched by its real path has no resolvable terminal"
status: todo
priority: 2
size: s
complexity: mid
process: direct
created: 2026-10-22T11:53:17Z
updated: 2026-10-22T17:59:02Z
depends: []
tags: [feedback, friction, "from:hq"]
agent: claude-code
---

Observed with relay v0.1.1 and Claude Code 2.1.304 on Linux. When Claude Code is started through its real executable (~/.local/share/claude/versions/2.1.304) instead of the ~/.local/bin/claude link, the process comm is the version string. isHarness accepts that (VERSION_COMM plus the claude/versions/ path), and resolveSessionPid finds the session, but resolveTerminalPid calls nearestTerminalPid(ancestors, 'claude') and finds nothing. An observer subscriber that needs the terminal pid then refuses every event ('could not find the claude-code process with a terminal among the ancestors: ... -> <pid>(2.1.304) -> zsh -> kitty'), so the session never appears in its projection. Expected: the terminal lookup uses the same harness predicate as isHarness. Workaround used: launch through the claude link.

## Notes

- 2026-10-22T17:59:02Z (main): scoped: the reported fix (terminal lookup uses isHarness) would break the measured background-under-systemd chain, where the versioned session holds a pty from bg-pty-host and its terminal must stay null. Approach: a version-binary process counts as a terminal only when its parent is not a bg-pty-host; amend the session-process-handle spec's terminal paragraph. direct: one predicate, settled by the fixture corpus.
