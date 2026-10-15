---
id: relay-f15f6f
title: "The test front door's test-one recipe interpolates its arguments unquoted, so a quoted multi-word --test-name-pattern is split into words: the pattern becomes the first word and the rest are passed as file arguments"
status: idea
priority: 2
reviewed: true
created: 2026-10-14T22:36:05Z
updated: 2026-10-15T12:37:17Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: claude-code/claude-opus-5-5
moved_from: ops-418bcd
---

just test-one --test-name-pattern "an expired deadline refuses" <file> ran 17 tests (pattern 'an') instead of 1; expected the quoted argument to arrive intact (e.g. set positional-arguments and "$@").

## Notes

- 2026-10-15T12:34:49Z (main): scope: drop; the ops front-door template has forwarded test-one arguments intact since 597989f (2026-09-28: set positional-arguments, sh -c '... "$@"' test-one "$@"), and 15 of 17 project test-one recipes use that form. The unquoted recipe is relay's own justfile:49-50 (test-one *args: node --test {{args}}, no set positional-arguments). obs's justfile:8-9 is also unquoted, and unwrapped by tt. Fix belongs to relay; proposal: move to relay with tasks move ops-418bcd --to relay (adopt the template's test-one form), or drop here naming relay as owner
- 2026-10-15T12:37:17Z (main): moved from ops-418bcd
  provenance: {"harness_session":"claude-code:975fb220-f6ce-4fc5-b44f-6fba336111ae","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
