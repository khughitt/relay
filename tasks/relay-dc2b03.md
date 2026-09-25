---
id: relay-dc2b03
title: "Darwin probe: scrub credential copies from a kept root, order --stages canonically, keep the root on a node crash"
status: done
priority: 2
size: s
complexity: low
process: direct
owner: relay-dc2b03
created: 2026-09-25T16:30:23Z
updated: 2026-09-25T21:32:42Z
started: 2026-09-25T21:32:42Z
completed: 2026-09-25T21:32:42Z
depends: []
parent: relay-1231bf
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

Final re-review of relay-b12132's fix wave (4b78336..ed893e5) left three small items: (1) tools/darwin-probe/run keeps the root when node exits abnormally, but a SIGKILLed ops relay-guard-probe leaves its 0600 auth.json/.credentials.json copy under <root>/d7 — delete credential copies under $ROOT before keeping it and say the kept root is unredacted; (2) probe.mjs keeps the user's --stages order, so --stages D9,D7 takes the gating isolation reading before D7 — order the requested list by STAGES; (3) node's own uncaught exception exits 1, which run treats as normal and removes the root — distinguish it (e.g. probe.mjs sets a dedicated code on a crash) and make credentialHits scan raw/ as well as out/.

## Notes

- 2026-09-25T21:32:42Z (relay-dc2b03): started
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:32:42Z (relay-dc2b03): Item 3 widened: a finalize (packing) failure also exits CRASHED (70), not 2 or the signal code, since it too leaves unpacked results in the root
- 2026-09-25T21:32:42Z (relay-dc2b03): done
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:32:42Z (relay-dc2b03): run deletes credential copies from a kept root and names it unredacted; --stages runs in canonical order; the probe's own crash (uncaught exception, unhandled rejection, failed packing) exits 70 so run keeps the root; the packing scan covers raw/ and out/
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
