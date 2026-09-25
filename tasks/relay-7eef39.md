---
id: relay-7eef39
title: "Darwin executableOf returns argv[0], so native Claude installs are not recognized"
status: done
priority: 1
size: s
complexity: mid
process: direct
owner: main
created: 2026-09-25T18:48:36Z
updated: 2026-09-25T19:18:53Z
started: 2026-09-25T19:08:42Z
completed: 2026-09-25T19:10:49Z
depends: []
parent: relay-1231bf
tags: []
source: relay-b12132
model: "claude-opus-5-5[1m]"
agent: claude-code/claude-opus-5-5
---

Mac attempt 2 of the Darwin probe (runbook, 2026-09-25T18:02; macOS 26.7 arm64) failed D4, a release gate: a Claude-shaped native install at …/claude/versions/9.9.9 started with argv0 '9.9.9' reads comm '9.9.9' on Darwin, and src/bus/proc.js executableOf (Darwin branch) returns ps -o comm= unchanged, so claude-code's native-install rule (src/adapters/claude-code.js:40: executable must end in /claude/versions/<comm>) never matches and resolveSessionPid misses the process. On macOS ps comm is argv[0] (the full path only when argv[0] is the full path); spec item 2's premise that Darwin comm holds the executable path is false. Fix: read the executable path from a source other than argv[0] (e.g. lsof -a -p PID -d txt -Fn's first txt entry, or libproc through a small helper) and fail closed when it is not absolute; revisit argvOf's comm-based argv[0] boundary for the same reason. Blocks relay-c19c0a.

## Notes

- 2026-09-25T19:08:42Z (main): started
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T19:10:49Z (relay-7eef39): done
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T19:10:49Z (relay-7eef39): Darwin executableOf reads the first text file lsof lists (absolute or PROCESS_UNREADABLE) instead of ps comm, which is argv[0]; argvOf drops the unmeasured basename branch; specs corrected. Proved on Linux by unit tests and a real-lsof parse; the Mac proof is D4 in relay-c19c0a's probe rerun
  provenance: {"harness_session":"claude-code:e2e5c9ac-0117-427a-bf31-489aecc94355","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T19:18:53Z (main): Mac verification of the lsof first-text-file assumption handed to the Mac session (task 1 of dist/relay-mac-handoff.md); relay-c19c0a's probe rerun stays the release proof
