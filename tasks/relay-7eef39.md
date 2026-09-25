---
id: relay-7eef39
title: "Darwin executableOf returns argv[0], so native Claude installs are not recognized"
status: todo
priority: 1
size: s
complexity: mid
process: direct
created: 2026-09-25T18:48:36Z
updated: 2026-09-25T18:48:36Z
depends: []
parent: relay-1231bf
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

Mac attempt 2 of the Darwin probe (runbook, 2026-09-25T18:02; macOS 26.7 arm64) failed D4, a release gate: a Claude-shaped native install at …/claude/versions/9.9.9 started with argv0 '9.9.9' reads comm '9.9.9' on Darwin, and src/bus/proc.js executableOf (Darwin branch) returns ps -o comm= unchanged, so claude-code's native-install rule (src/adapters/claude-code.js:40: executable must end in /claude/versions/<comm>) never matches and resolveSessionPid misses the process. On macOS ps comm is argv[0] (the full path only when argv[0] is the full path); spec item 2's premise that Darwin comm holds the executable path is false. Fix: read the executable path from a source other than argv[0] (e.g. lsof -a -p PID -d txt -Fn's first txt entry, or libproc through a small helper) and fail closed when it is not absolute; revisit argvOf's comm-based argv[0] boundary for the same reason. Blocks relay-c19c0a.
