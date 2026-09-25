---
id: relay-dc2b03
title: "Darwin probe: scrub credential copies from a kept root, order --stages canonically, keep the root on a node crash"
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-09-25T16:30:23Z
updated: 2026-09-25T16:30:23Z
depends: []
parent: relay-1231bf
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

Final re-review of relay-b12132's fix wave (4b78336..ed893e5) left three small items: (1) tools/darwin-probe/run keeps the root when node exits abnormally, but a SIGKILLed ops relay-guard-probe leaves its 0600 auth.json/.credentials.json copy under <root>/d7 — delete credential copies under $ROOT before keeping it and say the kept root is unredacted; (2) probe.mjs keeps the user's --stages order, so --stages D9,D7 takes the gating isolation reading before D7 — order the requested list by STAGES; (3) node's own uncaught exception exits 1, which run treats as normal and removes the root — distinguish it (e.g. probe.mjs sets a dedicated code on a crash) and make credentialHits scan raw/ as well as out/.
