---
id: relay-ba3153
title: "Darwin probe unit tests assume Linux: five fail under npm test on a real Mac"
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-09-25T20:06:04Z
updated: 2026-09-25T20:06:04Z
depends: []
tags: [darwin-probe]
source: relay-6e9410
agent: claude-code/claude-opus-5-5
---

Mac hand-back (docs/runbooks/darwin-mac-handback-2026-09-25.md, 'Baseline') ran npm test on macOS 26.7: five test/darwin-probe-* tests fail only because the host is a Mac (D2's release run excludes these files, so no gate is affected). (1) python3<3.11 test puts only a fake python3 on PATH, so the Darwin-only xcode-select check fails first with a different message; (2) constructed codex parent asserts ps comm is 'codex', but Darwin comm is argv[0], the full path; (3) 'a constructed parent that exits fails its wait at once' bounds < 2000 ms, observed 3.2-3.5 s; (4, 5) closing the terminal (/bin/sh, /bin/dash) finds no results tarball after ~60 s, uninvestigated. Also SIGINT after a normal D0 fails only under full-suite load (5/5 alone). Fix the test premises; investigate (4, 5) on a Mac.
