---
id: relay-3224bc
title: Remove pre-rewrite copies of relay's history once the rewrite is settled
status: todo
priority: 3
size: xs
complexity: low
process: direct
defer: 2026-11-17
created: 2026-10-18T22:46:11Z
updated: 2026-10-18T22:46:11Z
depends: []
tags: [git]
agent: claude-code/claude-opus-5-5
---

relay-06b733 (2026-10-18) and relay-653378 (2026-10-17) rewrote relay's history. The originals are still kept as backups, and they hold the work login and the old authorship. On WORK_ROOT/relay: identity-rewrite-20261017T004114Z/ and history-rewrite-20261018T*/ (all.bundle, mirror.git, replace.txt). In the Titan and Europa .git: reflogs keep the pre-rewrite commits. refs/ops/index-health/2026-10-16-* are two index snapshots from ops's bin/git-index-health, and each holds one file with the login. Deferred 30 days so the backups outlive any recovery need. Then: confirm nothing cites a pre-rewrite sha that the attached commit maps do not resolve; delete the WORK_ROOT backups; run git reflog expire --expire=now --all && git gc --prune=now on both hosts; ask ops (git-index-health) whether the two snapshots can be dropped. Nothing here is ever pushed: only main and tags go to origin.
