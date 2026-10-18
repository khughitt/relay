---
id: relay-848c0f
title: Darwin live probe at a current relay commit before the Mac cutover
status: todo
priority: 2
size: m
complexity: mid
process: direct
created: 2026-10-18T18:57:04Z
updated: 2026-10-18T18:57:04Z
depends: []
parent: relay-1231bf
tags: [darwin-probe]
agent: claude-code/claude-opus-5-5
---

Why: relay-c19c0a no longer waits on the Mac (rescope note 2026-10-18): the approved ops design requires a Darwin live probe before changing Darwin's installed hooks. This task gates the Mac portion of hq-539508 (relay hooks and the launchd reap on Darwin) and updating familiar on the Mac to a relay-pinned release. Attempt 3 (dist/relay-darwin-probe-df6f741.tar.gz, dist/relay-mac-handoff-3.md) was built 2026-09-25 and never run; it is stale.

Steps:
1. Build the bundle at the commit the Mac will run (v0.1.0 or later): just darwin-bundle <ops checkout>, then just darwin-bundle-check. Remove the stale df6f741 tarball and handoff-3 brief once the new ones exist.
2. Refresh the Mac Claude brief from dist/relay-mac-handoff-3.md against the new commit, keeping its tasks: baseline npm test; the lock load acceptance for relay-5e4d93 (four parallel eight-writer loops, 80/80; the CLI outer-timeout test 30 idle and 30 under load); relay-ba3153's test premises on mac/relay-ba3153. Add relay-64975d (relay model live acceptance on Darwin) and check relay-4b0aea's fixture leak there.
3. The user gives the Mac session the brief and tarball, then runs ./run with the Mac idle and returns the results tarball and branch bundle.
4. Merge the returned branch, run just darwin-judge <tarball> <ops checkout> in a worktree, commit the attempt section and darwin-evidence.json in docs/runbooks/darwin-probe.md.

Done: release-class checks (D0-D6, D8, ISO, D7w) pass on the physical Mac at a published relay commit, or each remaining failure is filed and relay-1231bf's scope says the Mac cutover is deferred.
