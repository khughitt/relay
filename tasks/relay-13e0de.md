---
id: relay-13e0de
title: Release procedure polish deferred from the v0.1.0 review
status: todo
priority: 4
size: s
complexity: low
process: direct
created: 2026-10-18T22:40:38Z
updated: 2026-10-18T22:40:38Z
depends: []
tags: [tooling]
agent: claude-code/claude-opus-5-5
---

Minor findings from relay-c19c0a's implementation review rounds 1-3, deferred under the review rules (docs/runbooks/release.md, tools/release/portability.mjs, tools/darwin-probe/bundle.mjs). None affected v0.1.0.
1. Published pre-images check: paginate (gh api --paginate), consider deleted branches and push actors, not only force_push.
2. Offline unit tests for the portability check's lockfile, manifest and reach logic (crafted lockfiles: no dependency entry, non-registry resolved, no integrity, wrong commit).
3. packDependencies packs only top-level dependencies: refuse at build time a packed dependency with dependencies of its own, which would fail D1's offline install only on the Mac.
4. Remote inventories ('no refs other than earlier release tags', 'nothing else') will trip on GitHub's refs/pull/* once a PR exists: exempt them.
5. 'With the network healthy' needs an operational control (an anonymous ls-remote of a known public repository) and a bound on reruns.
6. Ask for the rehearsal output in a task note and in the publication record list.
7. A df-generated bare '/' on a root-mounted checkout fails the control with no rebuild route.
8. Line 66 and the paths-control note claim more than the controls prove (only the pwd -P mount line is proven; hosts are confirmed by eye).
9. Stale counts: 'the two pattern files' (now three), 'never the terms' (also hosts).
10. The plan's Task 4 Step 1 omits the hosts search row.
11. One over-long line in docs/specs/2026-09-25-darwin-probe.md.
